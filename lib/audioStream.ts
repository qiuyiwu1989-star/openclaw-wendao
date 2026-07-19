// 流式 PCM16 播放器：边收边放。
// 把服务端转发的原始 PCM16(小端, 单声道) 字节流，用 Web Audio 无缝拼接播放。

export type StreamHandle = { stop: () => void };

type AudioCtor = typeof AudioContext;

export function pcmStreamSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window.AudioContext ||
      (window as unknown as { webkitAudioContext?: AudioCtor })
        .webkitAudioContext)
  );
}

/**
 * 播放一个 PCM16 字节流。
 * @param res      fetch 到的响应（body 为原始 PCM16 字节）
 * @param sampleRate 采样率（默认 24000）
 * @param onEnd     全部播完（自然结束）时回调
 * @returns 控制句柄，stop() 立即静音并释放
 */
export async function playPcmStream(
  res: Response,
  sampleRate = 24000,
  onEnd?: () => void
): Promise<StreamHandle> {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: AudioCtor }).webkitAudioContext;
  const ctx = new Ctor();
  try {
    await ctx.resume();
  } catch {
    /* 某些浏览器无需 resume */
  }

  let stopped = false;
  let nextTime = ctx.currentTime + 0.12; // 起播留一点缓冲，避免卡顿
  const sources: AudioBufferSourceNode[] = [];
  let leftover: Uint8Array | null = null;

  const handle: StreamHandle = {
    stop() {
      if (stopped) return;
      stopped = true;
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          /* ignore */
        }
      }
      ctx.close().catch(() => {});
    },
  };

  const reader = res.body!.getReader();

  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (stopped) break;
        if (done) break;
        if (!value || value.length === 0) continue;

        let bytes: Uint8Array = value;
        if (leftover) {
          const merged = new Uint8Array(leftover.length + bytes.length);
          merged.set(leftover);
          merged.set(bytes, leftover.length);
          bytes = merged;
          leftover = null;
        }
        const usable = bytes.length - (bytes.length % 2);
        if (usable < bytes.length) leftover = bytes.slice(usable);
        if (usable === 0) continue;

        // 拷贝出对齐到 2 字节边界的独立 buffer，供 Int16Array 使用
        const slice = bytes.slice(0, usable);
        const int16 = new Int16Array(slice.buffer, 0, usable / 2);
        const f32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;

        const buf = ctx.createBuffer(1, f32.length, sampleRate);
        buf.copyToChannel(f32, 0);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        const startAt = Math.max(nextTime, ctx.currentTime + 0.02);
        src.start(startAt);
        nextTime = startAt + buf.duration;
        sources.push(src);
      }
    } catch {
      /* 读流出错：结束 */
    } finally {
      if (!stopped) {
        const waitMs = Math.max(0, (nextTime - ctx.currentTime) * 1000) + 60;
        setTimeout(() => {
          if (stopped) return;
          onEnd?.();
          ctx.close().catch(() => {});
        }, waitMs);
      }
    }
  })();

  return handle;
}
