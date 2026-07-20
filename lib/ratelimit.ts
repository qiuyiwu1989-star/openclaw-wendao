// 极简内存限流：保护公开接口不被刷爆（对话/语音都要花钱）。
// 单实例滑动窗口，按 IP + 类别限。重启即清零——只为挡滥用，不做强一致。

type Bucket = number[];
const store = new Map<string, Bucket>();

// 定期清理，别让 Map 无限涨
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, arr] of store) {
    if (arr.length === 0 || arr[arr.length - 1] < now - 120_000) store.delete(k);
  }
}

/**
 * @returns ok=false 表示超限，retryAfter 为建议等待秒数
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number
): { ok: boolean; retryAfter: number } {
  sweep(now);
  const arr = store.get(key) || [];
  const cutoff = now - windowMs;
  // 丢掉窗口外的
  let i = 0;
  while (i < arr.length && arr[i] < cutoff) i++;
  const recent = i > 0 ? arr.slice(i) : arr;
  if (recent.length >= limit) {
    const retryAfter = Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
    store.set(key, recent);
    return { ok: false, retryAfter };
  }
  recent.push(now);
  store.set(key, recent);
  return { ok: true, retryAfter: 0 };
}

/** 从请求头取客户端 IP（nginx 反代后取 X-Forwarded-For / X-Real-IP） */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

/** 便捷包装：超限直接返回 429 Response，否则返回 null 放行 */
export function limitOr429(
  req: Request,
  category: string,
  limit: number,
  windowMs = 60_000
): Response | null {
  const ip = clientIp(req);
  const { ok, retryAfter } = rateLimit(`${category}:${ip}`, limit, windowMs, Date.now());
  if (ok) return null;
  return new Response(
    JSON.stringify({ error: "请求太频繁了，歇一会儿再说", retryAfter }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(retryAfter),
      },
    }
  );
}
