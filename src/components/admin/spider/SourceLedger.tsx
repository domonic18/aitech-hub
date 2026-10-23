/**
 * 分源台账(M34 批③ 验收反馈·问题2 自洞察中心迁入采集总览):占比堆叠条
 * +图例 + 各源总量/今日/占比表。纯展示,数据=insightOverview().bySource。
 */
import Link from "next/link";

import { MEDIUM_LABELS, SOURCE_COLORS, SOURCE_LABELS } from "@/components/admin/insight/shared";
import SourceShareBar from "@/components/admin/insight/SourceShareBar";
import type { InsightSourceStat } from "@/lib/insight/admin";
import { INSIGHT_SOURCES_ENABLED, type InsightSource } from "@/lib/insight/ingest";

export default function SourceLedger({
  stats,
}: {
  stats: InsightSourceStat[];
}): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-panel">
      <SourceShareBar stats={stats} />
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-xs text-text-2">
              <th className="px-4 py-2.5 font-medium">信号源</th>
              <th className="px-3 py-2.5 font-medium">介质</th>
              <th className="px-3 py-2.5 text-right font-medium">总量</th>
              <th className="px-3 py-2.5 text-right font-medium">今日</th>
              <th className="px-4 py-2.5 text-right font-medium">占比</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.source} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/admin/insight/?source=${s.source}`}
                    className="text-text-1 hover:text-accent"
                  >
                    {SOURCE_LABELS[s.source as InsightSource] ?? s.source}
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
                    {MEDIUM_LABELS[s.medium] ?? s.medium}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-[12px] text-text-1">
                  {s.total.toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-[12px] text-text-2">
                  {s.today.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-[11px] text-text-3">
                  {s.total > 0
                    ? `${Math.round((s.total / stats.reduce((a, x) => a + x.total, 0)) * 100)}%`
                    : "—"}
                </td>
              </tr>
            ))}
            {stats.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-text-3">
                  信号池还是空的:等热榜拉取(07:43)或前台评论入池
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 在役源序(趋势图例与台账同序;供采集总览趋势卡传 sources) */
export const LEDGER_SOURCES = [...INSIGHT_SOURCES_ENABLED] as InsightSource[];
