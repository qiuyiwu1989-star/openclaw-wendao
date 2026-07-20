import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "@/lib/persona";
import { limitOr429 } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MODEL = process.env.WENDAO_MODEL || "mimo-v2.5-pro";
const MAX_TOKENS = Number(process.env.WENDAO_MAX_TOKENS || 1024);
const LLM_BASE = process.env.LLM_BASE || "https://token-plan-cn.xiaomimimo.com";

type IncomingMessage = {
  role: "user" | "assistant";
  content: string;
};

function sanitize(messages: unknown): IncomingMessage[] {
  if (!Array.isArray(messages)) return [];
  const cleaned: IncomingMessage[] = [];
  for (const m of messages) {
    if (
      m &&
      typeof m === "object" &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.trim().length > 0
    ) {
      cleaned.push({ role: m.role, content: m.content });
    }
  }
  // Anthropic 要求首条为 user，最后一条为 user
  while (cleaned.length && cleaned[0].role !== "user") cleaned.shift();
  return cleaned;
}

export async function POST(req: Request) {
  const limited = limitOr429(req, "chat", 30);
  if (limited) return limited;

  const apiKey = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "服务端未配置 LLM_API_KEY" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "请求体不是合法 JSON" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const messages = sanitize((body as { messages?: unknown })?.messages);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return new Response(JSON.stringify({ error: "缺少有效的用户消息" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // fast=true（语音/通话模式）：关掉 MiMo 的"思考"，首句延迟砍掉近一半。
  // 打字/静默模式保留思考，不牺牲难题的锐度。
  const fast = (body as { fast?: unknown })?.fast === true;

  const client = new Anthropic({ apiKey, baseURL: `${LLM_BASE}/anthropic` });
  // 语音模式用精简提示词抢延迟；打字/深度模式用完整版
  const system = buildSystemPrompt(fast);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const params: Record<string, unknown> = {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          // 系统提示词很长且每次相同，MiMo 网关会自动做 prompt cache
          system,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        };
        // MiMo 默认会先"思考"再开口；语音模式显式关闭以抢延迟
        if (fast) params.thinking = { type: "disabled" };
        const anthropicStream = client.messages.stream(
          params as unknown as Parameters<typeof client.messages.stream>[0]
        );

        anthropicStream.on("text", (delta) => {
          controller.enqueue(encoder.encode(delta));
        });

        await anthropicStream.finalMessage();
        controller.close();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "对话生成失败，请稍后重试";
        // 把错误作为可见文本推给前端，避免静默空白
        controller.enqueue(encoder.encode(`\n\n[问道遇到问题：${msg}]`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
