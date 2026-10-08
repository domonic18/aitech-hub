/**
 * 构建期预渲染降级:Docker/CI 构建镜像时无 DB,首页/列表/sitemap 等静态
 * 预渲染的取数降级为空数据,产物按需 ISR(首次访问实查并缓存,arch/07-frontend
 * §1"无库降级按需 ISR")。仅在 Next 构建期(NEXT_PHASE)生效——运行时
 * ISR 再生错误照常上抛:命中旧缓存或 5xx,绝不静默吞错返空页。
 */
export function isPrerenderPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

export async function prerenderSafe<T>(
  event: string,
  fallback: T,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isPrerenderPhase()) return fn();
  try {
    return await fn();
  } catch (e) {
    console.warn(JSON.stringify({ event: `${event}.prerender.degraded`, error: String(e) }));
    return fallback;
  }
}
