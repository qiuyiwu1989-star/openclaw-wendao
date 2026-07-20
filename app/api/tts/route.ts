export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LLM_BASE = process.env.LLM_BASE || "https://token-plan-cn.xiaomimimo.com";
const TTS_MODEL = process.env.WENDAO_TTS_MODEL || "mimo-v2.5-tts";
const TTS_VOICE = process.env.WENDAO_TTS_VOICE || "苏打";
const SAMPLE_RATE = 24000; // MiMo pcm16 流式固定 24kHz 单声道

/**
 * 文字转语音。MiMo TTS 走 /v1/chat/completions：待朗读文本放 assistant 消息。
 * - 默认流式：audio.format=pcm16，SSE 分块返回 base64，本路由解码后以原始
 *   PCM16 字节流吐给前端，前端用 Web Audio 边收边放（首字节即开声）。
 * - stream=false：一次性返回完整 wav（降级/兼容用）。
 */
export async function POST(req: Request) {
  const apiKey = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonErr("未配置 LLM_API_KEY", 500);
  }

  let text = "";
  let voice = TTS_VOICE;
  let stream = true;
  try {
    const body = (await req.json()) as {
      text?: unknown;
      voice?: unknown;
      stream?: unknown;
    };
    if (typeof body.text === "string") text = body.text;
    if (typeof body.voice === "string" && body.voice.trim()) voice = body.voice;
    if (body.stream === false) stream = false;
  } catch {
    return jsonErr("请求体不合法", 400);
  }

  const clean = stripForSpeech(text).slice(0, 800);
  if (!clean) return jsonErr("空文本", 400);

  const upstreamBody = JSON.stringify({
    model: TTS_MODEL,
    stream,
    messages: [{ role: "assistant", content: clean }],
    audio: { format: stream ? "pcm16" : "wav", voice },
  });

  let upstream: Response;
  try {
    upstream = await fetch(`${LLM_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: upstreamBody,
    });
  } catch (err) {
    return jsonErr(err instanceof Error ? err.message : "TTS 请求异常", 500);
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return jsonErr(`TTS 失败(${upstream.status}) ${detail}`.trim(), 502);
  }

  // 非流式：解出整段 wav
  if (!stream) {
    const json = (await upstream.json()) as {
      choices?: { message?: { audio?: { data?: string } } }[];
    };
    const b64 = json.choices?.[0]?.message?.audio?.data;
    if (!b64) return jsonErr("TTS 无音频返回", 502);
    return new Response(Buffer.from(b64, "base64"), {
      headers: { "content-type": "audio/wav", "cache-control": "no-store" },
    });
  }

  // 流式：解析上游 SSE，把每块 base64 PCM16 解码为原始字节转发
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // 用 start 自驱读循环（不用 pull 的背压模型，避免收到 [DONE] 后仍挂住连接）
  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          let stop = false;
          while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            // 收到 [DONE] 立即收尾——MiMo 发完不一定关连接，
            // 死等 socket 关闭会把响应挂到超时。
            if (isDone(line)) {
              stop = true;
              break;
            }
            emit(line, controller);
          }
          if (stop) break;
        }
      } catch {
        /* 读流出错：照常收尾 */
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        reader.cancel().catch(() => {});
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });

  return new Response(out, {
    headers: {
      "content-type": "application/octet-stream",
      "x-sample-rate": String(SAMPLE_RATE),
      "cache-control": "no-store",
    },
  });
}

function isDone(line: string): boolean {
  const t = line.trim();
  return t.startsWith("data:") && t.slice(5).trim() === "[DONE]";
}

function emit(line: string, controller: ReadableStreamDefaultController<Uint8Array>) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return;
  try {
    const chunk = JSON.parse(payload) as {
      choices?: { delta?: { audio?: { data?: string } } }[];
    };
    const data = chunk.choices?.[0]?.delta?.audio?.data;
    if (data) controller.enqueue(new Uint8Array(Buffer.from(data, "base64")));
  } catch {
    /* 跳过无法解析的行 */
  }
}

function jsonErr(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** 去掉 Markdown 标记 / emoji，避免朗读出奇怪符号 */
function stripForSpeech(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-=]{3,}\s*$/gm, "")
    .replace(/\|/g, " ")
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/gu,
      ""
    )
    .replace(/\n{2,}/g, "\n")
    .trim();
}
