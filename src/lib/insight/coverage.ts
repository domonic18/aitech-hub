/**
 * 覆盖矩阵族级判定(M60):把「簇 × 多个单源」收敛成「簇 × 固定族数」。
 *
 * 背景:旧矩阵每个在役源一列(16 列),再接入新闻媒体/军事论坛等新域必爆横向宽度;
 * 族是稳定维度(≤6),新增源只增加族内成员,判定也从「单源零值」升级为「族级覆盖」:
 * - 内容空白:热簇有外部族信号、站内族(行为/评论)为 0 → 值得补稿;
 * - 自有特色:痛簇站内族 ≥3、外部族为 0 → 站内独有需求;
 * - 覆盖良好:所有**非停滞**族都有信号;其余为部分覆盖。
 * 停滞源(14 天无新信号)不参与判定(保留 M52 语义)。
 */
import {
  SOURCE_FAMILIES,
  sourcesInFamily,
  type InsightSource,
  type InsightSourceFamily,
} from "./source-registry";

export type CoverageVerdict = "blank" | "signature" | "covered" | "partial";

export const VERDICT_LABELS: Record<CoverageVerdict, string> = {
  blank: "内容空白",
  signature: "自有特色",
  covered: "覆盖良好",
  partial: "部分覆盖",
};

/** 自有特色的站内信号门槛(与原矩阵 internal >= 3 同口径) */
export const SIGNATURE_MIN_INTERNAL = 3;

export interface CoverageMember {
  source: InsightSource;
  count: number;
  stale: boolean;
}

export interface CoverageFamily {
  family: InsightSourceFamily;
  /** 族内全部在役源信号合计(含停滞源,展示用) */
  total: number;
  /** 族内成员**全部**停滞(该族不参与判定) */
  stale: boolean;
  members: CoverageMember[];
}

/** 单个簇的族级汇总(成员含 0 值源,便于行内展开看空缺) */
export function buildCoverageFamilies(
  sources: readonly { source: InsightSource; stale: boolean }[],
  cellOf: (source: InsightSource) => number,
): CoverageFamily[] {
  const staleOf = new Map(sources.map((s) => [s.source, s.stale]));
  return SOURCE_FAMILIES.map((family) => {
    const members: CoverageMember[] = sourcesInFamily(family).map((source) => ({
      source,
      count: cellOf(source),
      stale: staleOf.get(source) ?? true,
    }));
    return {
      family,
      total: members.reduce((a, m) => a + m.count, 0),
      stale: members.length === 0 || members.every((m) => m.stale),
      members,
    };
  });
}

const isInternal = (f: CoverageFamily): boolean => f.family === "internal";

/** 族级判定:停滞族不参与(站内族停滞 → 无从判断空白/特色);kind 沿用簇别(hot|pain) */
export function coverageVerdict(
  kind: string,
  families: readonly CoverageFamily[],
): CoverageVerdict {
  const live = families.filter((f) => !f.stale);
  const liveInternal = live.filter(isInternal);
  const liveExternal = live.filter((f) => !isInternal(f));
  const internal = liveInternal.reduce((a, f) => a + f.total, 0);
  const external = liveExternal.reduce((a, f) => a + f.total, 0);
  const canJudge = liveInternal.length > 0 && liveExternal.length > 0;
  if (canJudge && kind === "hot" && internal === 0 && external > 0) return "blank";
  if (canJudge && kind === "pain" && internal >= SIGNATURE_MIN_INTERNAL && external === 0) {
    return "signature";
  }
  if (live.length > 0 && live.every((f) => f.total > 0)) return "covered";
  return "partial";
}

/** 族占比分段(宽度百分比;全零回空数组,组件据此画灰底) */
export function familyShares(
  families: readonly CoverageFamily[],
): { family: InsightSourceFamily; pct: number }[] {
  const total = families.reduce((a, f) => a + f.total, 0);
  if (total === 0) return [];
  return families
    .filter((f) => f.total > 0)
    .map((f) => ({ family: f.family, pct: (f.total / total) * 100 }));
}
