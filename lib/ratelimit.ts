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

/**
 * 取客户端 IP。**必须信任 nginx 用 $remote_addr 注入的 X-Real-IP**（真实 TCP 对端，
 * nginx 会覆盖客户端自带值，无法伪造）。绝不能取 X-Forwarded-For 的第一个值——
 * nginx 的 $proxy_add_x_forwarded_for 会把客户端自带的 XFF 追加在最前，
 * 取 [0] 等于取攻击者可控值，限流会被塞随机 XFF 直接绕过。
 * 兜底才用 XFF，且取**最后一跳**（最接近可信的一段）。
 */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return "unknown";
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
