/**
 * 路径/参数数字 id 解析单源(M47 批B):此前六种实现三种上限两种目标类型
 * 各自漂移(parsePostId 无界、/^\d{1,19}$/、/^\d{1,10}$/+Number、每文件私有
 * ID_RE、illustration 静默归零),超界坏 id 落 DB 异常 500 面。helper 只做
 * 解析,失败返 null;错误码与文案由调用方定(多为 400 "invalid id")。
 */

/**
 * int64 上限(PostgreSQL bigint 最大值)。位数粗筛只是第一道:19 位并不都合法
 * (9223372036854775808 就溢出了),而超界值在 BigInt 层不抛,要等 Prisma 往
 * int64 列写才炸 —— 手拼的 `/post/9999999999999999999/` 因此变成 500 而不是 404。
 */
export const BIGINT_MAX = BigInt("9223372036854775807");

const BIGINT_ID_RE = /^\d{1,19}$/;

/** 合法 bigint 主键形态(纯数字串且不超 int64)。Zod 侧用 `.refine(isBigIntId)` —— 本文件
 * 保持零 zod 依赖:post-path/pin-path 是客户端也会 import 的纯函数模块。 */
export function isBigIntId(raw: string): boolean {
  return BIGINT_ID_RE.test(raw) && BigInt(raw) <= BIGINT_MAX;
}

/** bigint 主键族(post/topic/pin 等 int64 列):合法形态 → BigInt,否则 null */
export function parseBigIntId(raw: string): bigint | null {
  return isBigIntId(raw) ? BigInt(raw) : null;
}

/** 数值主键族(bloggers/models/channels 等 int 列):Number 安全整数上限内(15 位) */
export function parseNumericId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}
