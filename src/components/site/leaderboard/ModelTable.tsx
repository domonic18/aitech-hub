/**
 * 模型紧凑表(M63):散点页签的「完整数据表」折叠区与价格未采到时的回退形态。
 * 只服务模型榜(智能指数/输出价两列),论文与仓库不走表格。
 */
import { formatPrice, formatScore } from "@/lib/leaderboard/format";
import type { PublicLeaderboardRow } from "@/lib/leaderboard/public";

import { DeltaMark, EntityLink } from "./shared";

export function ModelTable({
  rows,
  hasPrevious,
}: {
  rows: PublicLeaderboardRow[];
  hasPrevious: boolean;
}): React.ReactElement {
  const hasPrice = rows.some((r) => (r.extra.price1mOutputTokens ?? 0) > 0);
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-panel">
      <table className="w-full min-w-[560px] text-left">
        <thead>
          <tr className="border-b border-line/70 font-mono text-[11px] text-text-3">
            <th className="w-14 px-3 py-2 font-normal">名次</th>
            <th className="w-14 px-3 py-2 font-normal">变动</th>
            <th className="px-3 py-2 font-normal">模型</th>
            <th className="w-32 px-3 py-2 font-normal">厂商</th>
            <th className="w-20 px-3 py-2 font-normal">智能指数</th>
            {hasPrice && <th className="w-24 px-3 py-2 font-normal">输出价</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.entityKey} className="border-b border-line/40 last:border-b-0">
              <td className="px-3 py-2 font-mono text-[12.5px] text-text-2">{row.rank}</td>
              <td className="px-3 py-2">
                <DeltaMark delta={row.delta} hasPrevious={hasPrevious} />
              </td>
              <td className="min-w-0 px-3 py-2">
                <span className="block truncate">
                  <EntityLink row={row} />
                </span>
              </td>
              <td className="min-w-0 px-3 py-2">
                <span className="block truncate text-[12px] text-text-2">{row.vendor ?? "—"}</span>
              </td>
              <td className="px-3 py-2 font-mono text-[12px] text-text-2">
                {formatScore(row.score, null)}
              </td>
              {hasPrice && (
                <td className="px-3 py-2 font-mono text-[12px] text-text-2">
                  {formatPrice(row.extra.price1mOutputTokens) || "—"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
