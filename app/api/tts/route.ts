export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LLM_BASE = process.env.LLM_BASE || "https://token-plan-cn.xiaomimimo.com";
const TTS_MODEL = process.env.WENDAO_TTS_MODEL || "mimo-v2.5-tts";
const TTS_VOICE = process.env.WENDAO_TTS_VOICE || "冰糖";

/**
 * 把一段文字合成语音。MiMo TTS 走 /v1/chat/completions：
 * 待朗读文本放在 assistant 角色消息里，audio 指定格式与音色，
 * 返回 message.audio.data 为 base64 wav。
 */
export async function POST(req: Request) {
  const apiKey = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "未配置 LLM_API_KEY" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  let text = "";
  let voice = TTS_VOICE;
  try {
    const body = (await req.json()) as { text?: unknown; voice?: unknown };
    if (typeof body.text === "string") text = body.text;
    if (typeof body.voice === "string" && body.voice.trim()) voice = body.voice;
  } catch {
    return new Response(JSON.stringify({ error: "请求体不合法" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const clean = stripForSpeech(text).slice(0, 800);
  if (!clean) {
    return new Response(JSON.stringify({ error: "空文本" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const upstream = await fetch(`${LLM_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        messages: [{ role: "assistant", content: clean }],
        audio: { format: "wav", voice },
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: `TTS 失败(${upstream.status})`, detail }),
        { status: 502, headers: { "content-type": "application/json" } }
      );
    }

    const json = (await upstream.json()) as {
      choices?: { message?: { audio?: { data?: string } } }[];
    };
    const b64 = json.choices?.[0]?.message?.audio?.data;
    if (!b64) {
      return new Response(JSON.stringify({ error: "TTS 无音频返回" }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }

    const buf = Buffer.from(b64, "base64");
    return new Response(buf, {
      headers: {
        "content-type": "audio/wav",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "TTS 请求异常";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
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
