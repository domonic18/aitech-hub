/**
 * 牌价终审闸门(M75 运维面,纯函数):上架严、下架宽。
 *
 * 为什么要闸门:采集落 pending、只有 enabled 进前台公开页(/pricing/,错价=信任
 * 损失);「待复核」= 该源上次采集失败时旧行被打标,价已陈旧。
 * 为什么下架宽:enabled→disabled 是止损,错下架(少一行)与错上架(公开错价)
 * 代价不对称——但**人工定稿行(is_pinned)例外**:定稿是人工确认过的价,采集
 * 失败不等于价错,两条下架路径(逐条下架 / 按源下架)都不动它。
 *
 * 判定在 MCP 工具层调用(见 lib/mcp/tools.ops.actions.ts);阈值与健康判定同源
 * (collect/health-report.ts),口径不各写一份。
 */
import { HEALTH_THRESHOLDS } from "@/lib/collect/health-report";

// ── 牌价终审闸门(上架严、下架宽) ────────────────────────────────────

/** 被拒的判据码 */
export type PricingReviewReject = "recheck_marked" | "source_unhealthy" | "same_state";

export interface PricingReviewRow {
  id: string;
  vendor: string;
  modelKey: string;
  /** pending | enabled | disabled */
  status: string;
  note: string | null;
  /** 人工定稿行(采集不覆盖):下架时不动 */
  isPinned?: boolean;
  /** 行所属产出面:model=模型牌价表 / plan=套餐表(兄弟源靠它分开) */
  target?: "model" | "plan";
  /** 行的厂商归一键(provider 字典;聚合行的源解析靠它,见 source-resolve.ts) */
  providerKey?: string | null;
}

export interface PricingReviewSource {
  status: string;
  consecutiveFails: number;
}

export interface PricingReviewDecision {
  id: string;
  /** apply=落库;skip=已同态无事可做;reject=闸门拦下 */
  action: "apply" | "skip" | "reject";
  reason?: string;
}

/** 待复核标记(采集失败时整源旧行被打标;与 pending 不是一回事) */
const RECHECK_MARK = "【待复核";

/**
 * 牌价行终审判定:上架严(带待复核标/源在坏 → 拒),下架宽(止损优先,人工定稿行除外)。
 *
 * 上架严的理由:采集落 pending、只有 enabled 进前台公开页(/pricing/,错价=信任
 * 损失);「待复核」= 该源上次采集失败时旧行被打标,价已陈旧。
 * 下架宽的理由:enabled→disabled 是止损,错下架(少一行)与错上架(公开错价)
 * 代价不对称。
 *
 * 源↔行的解析与健康读侧同源:走 source-resolve(providerKey + 产出面优先,
 * vendor 兜底——聚合行的 vendor 对不上源,靠 providerKey 才连得上;兄弟源靠
 * 产出面分开,否则会拿兄弟源的健康状态当自己的)。
 */
export function decidePricingReview(
  rows: PricingReviewRow[],
  target: "enabled" | "disabled",
  sourceOf: (
    row: Pick<PricingReviewRow, "vendor" | "target" | "providerKey">,
  ) => PricingReviewSource | undefined,
): PricingReviewDecision[] {
  return rows.map((row) => {
    if (row.status === target) {
      return { id: row.id, action: "skip" as const, reason: `已是 ${target} 状态` };
    }
    if (target === "disabled") {
      if (row.isPinned === true) {
        return { id: row.id, action: "skip" as const, reason: "人工定稿行,不下架" };
      }
      return { id: row.id, action: "apply" as const };
    }
    // 上架:两道闸
    if ((row.note ?? "").includes(RECHECK_MARK)) {
      return {
        id: row.id,
        action: "reject" as const,
        reason: "行带「待复核」标(源上次采集失败,价已陈旧),先重采再上架",
      };
    }
    const source = sourceOf({
      vendor: row.vendor,
      target: row.target,
      providerKey: row.providerKey,
    });
    if (source === undefined) {
      return {
        id: row.id,
        action: "reject" as const,
        reason: "找不到该行对应的采集源,无法确认数据新鲜度",
      };
    }
    if (
      source.status === "error" ||
      source.consecutiveFails >= HEALTH_THRESHOLDS.consecutiveFails
    ) {
      return {
        id: row.id,
        action: "reject" as const,
        reason: `采集源不健康(status=${source.status},连败 ${source.consecutiveFails}),先修复源`,
      };
    }
    return { id: row.id, action: "apply" as const };
  });
}
