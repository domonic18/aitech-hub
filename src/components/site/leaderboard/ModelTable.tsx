/**
 * 模型紧凑表(M63):散点图下「完整数据表」折叠区与价格未采到时的回退形态。
 * 只服务「模型能力与价格」一节(能力分/输出价两列),HF 与仓库各有自己的表/卡。
 * 输出价两币同渲染(￥折算 / $ 原文),显隐由 ModelBoard 的币种开关经 CSS 控制。
 */
import { formatCnyPrice, formatPrice, formatScore } from "@/lib/leaderboard/format";
import type { PublicLeaderboardRow } from "@/lib/leaderboard/public";

import { DeltaMark, EntityLink } from "./shared";

export function ModelTable({
  rows,
  hasPrevious,
  rate,
}: {
  rows: PublicLeaderboardRow[];
  hasPrevious: boolean;
  /** 1 USD 折合人民币;人民币列 = 原价 × rate */
  rate: number;
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
            <th className="w-20 px-3 py-2 font-normal">能力分</th>
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
                  {row.extra.price1mOutputTokens === undefined ? (
                    "—"
                  ) : (
                    <>
                      <span className="cur-cny">
                        {formatCnyPrice(row.extra.price1mOutputTokens * rate)}
                      </span>
                      <span className="cur-usd">{formatPrice(row.extra.price1mOutputTokens)}</span>
                    </>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
