/**
 * discovery 域时间工具(M25):异步 sleep + 风控纪律随机间隔。
 * 间隔必须随机化——固定值是可指纹特征(方案 §8 实证口径)。
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** [min,max] 闭区间随机毫秒 */
export function randomGapMs(range: readonly [number, number]): number {
  const [min, max] = range;
  return min + Math.floor(Math.random() * (max - min + 1));
}
