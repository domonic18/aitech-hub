/**
 * 痛点机会榜(M34 批② 核心视图;验收反馈·问题4 紧凑化):卡片格改行式排行
 * ——机会分 + 分数比例条 + 簇名 + 覆盖度徽章(空白标红=选题机会)+ 7 日趋势,
 * 整行可点进簇详情;高度较卡格砍半。
 */
import Link from "next/link";

import Sparkline from "@/components/admin/usage/Sparkline";
import type { InsightClusterRow } from "@/lib/insight/admin";
import { AnomalyBadge, COVERAGE_LABELS, MediaBadges } from "./shared";

/** 覆盖度徽章(行内紧凑版;blank 标红=选题机会) */
function CoveragePill({ state }: { state: string | null }): React.ReactElement | null {
  if (state === null) return null;
  const tone =
    state === "blank"
      ? "bg-red/12 text-red"
      : state === "partial"
        ? "bg-amber/12 text-amber-hi"
        : "bg-green/12 text-green";
  return (
    <span className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap ${tone}`}>
      {COVERAGE_LABELS[state] ?? state}
    </span>
  );
}

export default function PainCardGrid({
  clusters,
}: {
  clusters: InsightClusterRow[];
}): React.ReactElement {
  if (clusters.length === 0) {
    return (
      <div className="rounded-md border border-line bg-panel px-4 py-8 text-center text-xs text-text-3">
        暂无痛点簇:成员 ≥3 的信号簇经日批(03:57)打标后在此出榜——先在
        <Link href="/admin/models" className="mx-0.5 text-accent hover:underline">
          AI 配置
        </Link>
        绑定「洞察归纳」模型,或用 CLI <code className="font-mono">insight:run -- cluster</code>{" "}
        手动跑一轮
      </div>
    );
  }
  const max = Math.max(...clusters.map((c) => c.score ?? 0), 1);
  // 自 F11 起宿主于页侧 Card 壳(F11 板),自身不再画面板框
  return (
    <div>
      {clusters.map((c) => (
        <Link
          key={c.id}
          href={`/admin/insight/clusters/${c.id}`}
          className="flex items-center gap-3 rounded-sm px-2 py-2.5 hover:bg-panel-2"
        >
          <span className="w-7 shrink-0 text-right font-mono text-sm font-semibold text-text-1">
            {c.score !== null ? Math.round(c.score) : "—"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span
                className="truncate text-[13px] font-medium text-text-1"
                title={c.label ?? undefined}
              >
                {c.label ?? "待打标簇"}
              </span>
              <CoveragePill state={c.coverageState} />
              {c.anomaly && <AnomalyBadge />}
              <MediaBadges media={c.media} />
            </span>
            <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-panel-2">
              <span
                className={`block h-full rounded-full ${c.coverageState === "blank" ? "bg-red opacity-80" : "bg-accent opacity-80"}`}
                style={{ width: `${c.score !== null ? Math.max(3, (c.score / max) * 100) : 0}%` }}
              />
            </span>
          </span>
          <span className="w-20 shrink-0">
            <Sparkline data={c.history} />
          </span>
          <span className="w-14 shrink-0 text-right font-mono text-[11px] text-text-3">
            {c.members} 条
          </span>
        </Link>
      ))}
    </div>
  );
}
