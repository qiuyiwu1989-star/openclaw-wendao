import { limitOr429 } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LLM_BASE = process.env.LLM_BASE || "https://token-plan-cn.xiaomimimo.com";
const ASR_MODEL = process.env.WENDAO_ASR_MODEL || "mimo-v2.5-asr";

/**
 * 语音转文字。浏览器录一段 wav（原始字节）POST 过来，本路由转 base64 交给
 * MiMo ASR（走 /v1/chat/completions，音频放 user 消息的 input_audio），
 * 返回转写文本。用 MiMo 而非浏览器 Web Speech API——后者走谷歌服务器，国内被墙。
 */
export async function POST(req: Request) {
  const limited = limitOr429(req, "asr", 80);
  if (limited) return limited;

  const apiKey = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonErr("未配置 LLM_API_KEY", 500);
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await req.arrayBuffer();
  } catch {
    return jsonErr("读取音频失败", 400);
  }
  if (bytes.byteLength < 1200) {
    // 太短基本是没说话/噪声
    return new Response(JSON.stringify({ text: "" }), {
      headers: { "content-type": "application/json" },
    });
  }

  const format =
    new URL(req.url).searchParams.get("format") ||
    (req.headers.get("content-type")?.includes("wav") ? "wav" : "wav");
  const b64 = Buffer.from(bytes).toString("base64");

  try {
    const upstream = await fetch(`${LLM_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ASR_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "input_audio", input_audio: { data: b64, format } },
            ],
          },
        ],
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      return jsonErr(`ASR 失败(${upstream.status}) ${detail}`.trim(), 502);
    }
    const json = (await upstream.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = (json.choices?.[0]?.message?.content || "").trim();
    return new Response(JSON.stringify({ text }), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (err) {
    return jsonErr(err instanceof Error ? err.message : "ASR 请求异常", 500);
  }
}

function jsonErr(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
