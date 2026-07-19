export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 轻量健康检查：判「进程是否响应」。部署脚本 / watchdog 用它——
// 只要返回 200 就算活着（000/5xx 才算挂），不在这里 ping 上游以免拖慢/花钱。
export async function GET() {
  const llmConfigured = !!(
    process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY
  );
  return new Response(
    JSON.stringify({
      ok: true,
      service: "wendao",
      llmConfigured,
    }),
    { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } }
  );
}
