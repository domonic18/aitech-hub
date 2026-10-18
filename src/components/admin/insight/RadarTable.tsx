/**
 * 热点雷达表(M34 批②,方案 §6):簇列表行=簇名/介质/信号数/机会分/7 日趋势
 * /异动/最近活跃;30 日热力格在簇详情页。热点簇(hot)为主视图,痛点簇已上
 * 痛点榜卡格,不重复出表。
 */
import type { InsightClusterRow } from "@/lib/insight/admin";
import Sparkline from "@/components/admin/usage/Sparkline";
import { AnomalyBadge, ClusterLabelLink, MediaBadges, formatTime } from "./shared";

export default function RadarTable({
  clusters,
}: {
  clusters: InsightClusterRow[];
}): React.ReactElement {
  if (clusters.length === 0) {
    return (
      <div className="rounded-md border border-line bg-panel px-4 py-8 text-center text-xs text-text-3">
        热点簇暂空:站内热点信号批③ 外部源(热榜/评论)接入后进入雷达
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-panel">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line bg-panel-2 text-xs text-text-2">
            <th className="px-4 py-2.5 font-medium">热点簇</th>
            <th className="px-3 py-2.5 font-medium">介质</th>
            <th className="px-3 py-2.5 text-right font-medium">信号数</th>
            <th className="px-3 py-2.5 text-right font-medium">机会分</th>
            <th className="px-3 py-2.5 font-medium">近 7 日</th>
            <th className="px-3 py-2.5 font-medium">异动</th>
            <th className="px-4 py-2.5 text-right font-medium">最近活跃</th>
          </tr>
        </thead>
        <tbody>
          {clusters.map((c) => (
            <tr key={c.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
              <td className="max-w-64 px-4 py-2.5">
                <span className="block truncate text-[13px]">
                  <ClusterLabelLink id={c.id} label={c.label} />
                </span>
                {c.summary !== null && (
                  <span className="block truncate text-[11px] text-text-3" title={c.summary}>
                    {c.summary}
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5">
                <MediaBadges media={c.media} />
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-[12px] text-text-1">
                {c.members}
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-[12px] text-text-1">
                {c.score !== null ? Math.round(c.score) : "—"}
              </td>
              <td className="w-24 px-3 py-2.5">
                <Sparkline data={c.history} />
              </td>
              <td className="px-3 py-2.5">{c.anomaly ? <AnomalyBadge /> : null}</td>
              <td className="px-4 py-2.5 text-right font-mono text-[11px] text-text-3">
                {c.recentAt !== null ? formatTime(c.recentAt) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
