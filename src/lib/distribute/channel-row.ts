/**
 * 渠道行 ensure 统一口(M49 批X1 自 wechat-sync/pin-wechat-sync 收口):
 * 唯一键(postId/pinId × channel)并发首建冲突 P2002 → 以库内行为准。
 * find/create 由调用方注入(publish_channel 与 content_pin_channel 两表形状);
 * enqueue 侧「pending 先判后建」的僵尸行防线不在此(判的是 status 语义,各口自持)。
 */
import { isP2002 } from "../db";

export async function ensureChannelRowUnique<T>(
  find: () => Promise<T | null>,
  create: () => Promise<T>,
): Promise<T> {
  const found = await find();
  if (found !== null) return found;
  try {
    return await create();
  } catch (e) {
    if (!isP2002(e)) throw e;
    const row = await find();
    if (row === null) throw e;
    return row;
  }
}
