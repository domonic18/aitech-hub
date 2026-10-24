/**
 * 路径/参数数字 id 解析单源(M47 批B):此前六种实现三种上限两种目标类型
 * 各自漂移(parsePostId 无界、/^\d{1,19}$/、/^\d{1,10}$/+Number、每文件私有
 * ID_RE、illustration 静默归零),超界坏 id 落 DB 异常 500 面。helper 只做
 * 解析,失败返 null;错误码与文案由调用方定(多为 400 "invalid id")。
 */

/** bigint 主键族(post/topic/pin 等 int64 列):1-19 位纯数字串(int64 上限 19 位) */
export function parseBigIntId(raw: string): bigint | null {
  if (!/^\d{1,19}$/.test(raw)) return null;
  return BigInt(raw);
}

/** 数值主键族(bloggers/models/channels 等 int 列):Number 安全整数上限内(15 位) */
export function parseNumericId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}
