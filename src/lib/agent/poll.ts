/**
 * Agent 工具共用的出图轮询(技术债批④,自 topic/cover 两工具的同款循环收口):
 * 生图云厂商通常 10-30s × 多候选,3s 步进、120s 兜底超时。probe 返回非空即
 * 命中收工;超时返 null,由调用方落各自的人话错误面。
 */

/** 轮询步进(ms):生图 10-30s,3s 足够跟手 */
export const POLL_INTERVAL_MS = 3000;
/** 兜底超时(ms):2 分钟,超时提示可重试 */
export const POLL_MAX_MS = 120_000;

/** 每拍探测,命中返结果、未命中返 null(调用方闭包持有 token 等上下文) */
export async function pollUntil<T>(probe: () => Promise<T | null>): Promise<T | null> {
  const startedAt = Date.now();
  for (;;) {
    const hit = await probe();
    if (hit !== null) return hit;
    if (Date.now() - startedAt > POLL_MAX_MS) return null;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}
