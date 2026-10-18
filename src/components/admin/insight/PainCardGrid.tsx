/**
 * 痛点榜卡格(M34 批②,方案 §6 核心视图):簇名+一句话概括+信号数+介质徽章
 * +内容覆盖度徽章(空白标红=选题机会)+异动高亮+7 日趋势 sparkline。
 */
import Link from "next/link";

import Sparkline from "@/components/admin/usage/Sparkline";
import type { InsightClusterRow } from "@/lib/insight/admin";
import { AnomalyBadge, ClusterLabelLink, CoverageBadge, MediaBadges } from "./shared";

export default function PainCardGrid({
  clusters,
}: {
  clusters: InsightClusterRow[];
}): React.ReactElement {
  if (clusters.length === 0) {
    return (
      <div className="rounded-md border border-line bg-panel px-4 py-8 text-center text-xs text-text-3">
        暂无痛点簇:成员 ≥3 的信号簇经日批打标后在此出榜(需在 AI 配置绑定「洞察归纳」模型)
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {clusters.map((c) => {
        const topKeyword = c.keywords[0];
        return (
          <div
            key={c.id}
            className={`rounded-md border bg-panel px-4 py-3 ${
              c.anomaly ? "border-red" : "border-line"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-medium">
                <ClusterLabelLink id={c.id} label={c.label} />
              </span>
              {c.anomaly && <AnomalyBadge />}
              {c.status === "fading" && (
                <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-3">
                  退热
                </span>
              )}
              <span className="ml-auto font-mono text-sm font-semibold text-text-1">
                {c.score !== null ? Math.round(c.score) : "—"}
              </span>
            </div>
            {c.summary !== null && (
              <p className="mt-1 line-clamp-2 text-xs text-text-2" title={c.summary}>
                {c.summary}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <MediaBadges media={c.media} />
              <CoverageBadge score={c.coverageScore} state={c.coverageState} />
              {topKeyword !== undefined && (
                <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 text-[11px] text-text-2">
                  #{topKeyword}
                </span>
              )}
            </div>
            <div className="mt-2 flex items-center gap-3">
              <Link
                href={`/admin/insight/clusters/${c.id}`}
                className="font-mono text-[11px] text-text-3 hover:text-accent"
              >
                {c.members} 条信号
              </Link>
              <span className="min-w-16 flex-1">
                <Sparkline data={c.history} />
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
