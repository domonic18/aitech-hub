/**
 * 行价基准策略共性层(牌价改造 P2;M77 红线的采集侧实现):行价=入口价。
 *
 * 从 bailian-rows 的两个私有 picker 泛化(方舟图片格 pickBaseEntry 是同策略的
 * 格内实现,粒度不同保持原位)。两类口径:
 * - token 系:取「全球」档(国内用户口径),没有则取第一条有价的;
 * - 按张/按秒(模态计价):档位维度是分辨率,取**最低分辨率档**(入口价),
 *   部署范围有「全球」行时只在全球行里挑;同分辨率多行取价低的那条。
 *
 * 新源(可灵/Vidu/MiniMax 官方等图像/视频源)按此声明基准,保证全站
 * 「行价=最低分辨率档」口径单一出处。
 */
import { resolutionRank } from "../resolution";

/** 基准选取所需的最小行形态(结构 duck-typing,各源记录直接传) */
export interface BasePriceRecord {
  /** 部署范围/地域列(「全球」);无此列为 null */
  scope: string | null;
  /** 档位维度原文(分辨率/视频类型;tokenRange 之外的维度) */
  cond: string | null;
  input: number | null;
  output: number | null;
}

const hasPrice = (r: BasePriceRecord): boolean => r.input !== null || r.output !== null;
const priceOf = (r: BasePriceRecord): number => r.output ?? r.input ?? Number.POSITIVE_INFINITY;

/** token 系基准:「全球」档优先,否则第一条有价的 */
export function pickTokenBase<T extends BasePriceRecord>(rows: T[]): T {
  return rows.find((r) => r.scope === "全球") ?? rows.find((r) => hasPrice(r)) ?? rows[0]!;
}

/** 模态计价基准:最低分辨率档(入口价);同分辨率取价低 */
export function pickResolutionBase<T extends BasePriceRecord>(rows: T[]): T {
  const priced = rows.filter(hasPrice);
  const globalRows = priced.filter((r) => r.scope === "全球" || r.scope === null);
  const pool = globalRows.length > 0 ? globalRows : priced;
  const withRes = pool.filter((r) => resolutionRank(r.cond) !== null);
  if (withRes.length === 0) return pool[0] ?? rows[0]!;
  return withRes.reduce((a, b) => {
    const am = resolutionRank(a.cond)!;
    const bm = resolutionRank(b.cond)!;
    if (am !== bm) return bm < am ? b : a;
    return priceOf(b) < priceOf(a) ? b : a;
  });
}
