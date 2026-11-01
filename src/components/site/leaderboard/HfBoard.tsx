/**
 * Hugging Face 热门模型(M63 v2,独立成节):二维散点——横轴累计下载量、纵轴
 * 点赞数(双对数)。右上「又火又被认可」、左上「小众但好评」、右下「大众工具型」。
 * 下载量/点赞数缺失或样本不足时退化为完整表 + 补采提示,不画空图。
 */
import { formatCompact, formatScore } from "@/lib/leaderboard/format";
import type { PublicLeaderboard } from "@/lib/leaderboard/public";
import { buildScatterGeometry } from "@/lib/leaderboard/scatter";
import { HF_SCATTER_OPTIONS, hfScatterData } from "@/lib/leaderboard/scatter-data";

import { BoardFrame } from "./BoardFrame";
import { ScatterChart } from "./ScatterChart";
import { Chip, DeltaMark, EntityLink } from "./shared";

const HINT =
  "横轴是累计下载量,纵轴是点赞数(两轴都是对数刻度)。右上角 = 下载多、口碑也好;左上角 = 小众但好评;右下角 = 大众工具型、点赞相对少。颜色区分所属组织,标注是趋势榜名次靠前的模型。";

function HfTable({ board }: { board: PublicLeaderboard }): React.ReactElement {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-panel">
      <table className="w-full min-w-[620px] text-left">
        <thead>
          <tr className="border-b border-line/70 font-mono text-[11px] text-text-3">
            <th className="w-14 px-3 py-2 font-normal">名次</th>
            <th className="w-14 px-3 py-2 font-normal">变动</th>
            <th className="px-3 py-2 font-normal">模型</th>
            <th className="w-32 px-3 py-2 font-normal">组织</th>
            <th className="w-24 px-3 py-2 font-normal">下载</th>
            <th className="w-20 px-3 py-2 font-normal">点赞</th>
            <th className="w-24 px-3 py-2 font-normal">趋势分</th>
          </tr>
        </thead>
        <tbody>
          {board.rows.map((row) => (
            <tr key={row.entityKey} className="border-b border-line/40 last:border-b-0">
              <td className="px-3 py-2 font-mono text-[12.5px] text-text-2">{row.rank}</td>
              <td className="px-3 py-2">
                <DeltaMark delta={row.delta} hasPrevious={board.hasPrevious} />
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
                {formatCompact(row.extra.downloads) || "—"}
              </td>
              <td className="px-3 py-2 font-mono text-[12px] text-text-2">
                {formatCompact(row.extra.likes) || "—"}
              </td>
              <td className="px-3 py-2 font-mono text-[12px] text-text-2">
                {formatScore(row.score, null)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobileList({ board }: { board: PublicLeaderboard }): React.ReactElement {
  return (
    <ol className="mt-3 space-y-2 sm:hidden">
      {board.rows.slice(0, 10).map((row) => (
        <li key={row.entityKey} className="rounded-lg border border-line bg-panel px-3 py-2.5">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 w-6 flex-none font-mono text-[12px] text-text-3">
              {row.rank}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] leading-snug">
                <EntityLink row={row} />
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-3">
                <DeltaMark delta={row.delta} hasPrevious={board.hasPrevious} />
                {row.extra.downloads !== undefined && (
                  <Chip>下载 {formatCompact(row.extra.downloads)}</Chip>
                )}
                {row.extra.likes !== undefined && (
                  <Chip tone="amber">赞 {formatCompact(row.extra.likes)}</Chip>
                )}
              </span>
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function HfBoard({ board }: { board: PublicLeaderboard }): React.ReactElement {
  const data = hfScatterData(board);
  const geometry = buildScatterGeometry(data, HF_SCATTER_OPTIONS);
  const canScatter = geometry.points.length >= 2;

  return (
    <BoardFrame
      id="hf"
      title="Hugging Face 热门模型"
      hint={HINT}
      capturedDate={board.capturedDate}
      staleDays={board.staleDays}
      sources={[{ label: board.label, url: board.sourceUrl }]}
    >
      {canScatter ? (
        <>
          <ScatterChart
            geometry={geometry}
            data={data}
            rows={board.rows}
            ariaLabel="Hugging Face 模型下载量与点赞数散点图,右上角为下载多且点赞高"
            xTitle="累计下载量(对数轴)"
            yTitle="点赞数(对数轴)"
            quadLabel="小众但好评"
            missingNote={
              geometry.missingCount > 0
                ? `${String(geometry.missingCount)} 个模型缺少下载量或点赞数,未绘入散点`
                : null
            }
            tooltip={(row, p) => [
              row?.entityName ?? p.name,
              p.vendor ?? "",
              `下载 ${formatCompact(p.x)}`,
              `赞 ${formatCompact(p.y)}`,
              `趋势分 ${formatScore(row?.score ?? null, null)}`,
              row?.extra.pipelineTag ?? "",
            ]}
            mobile={<MobileList board={board} />}
          />
          <details className="mt-4">
            <summary className="cursor-pointer text-[12px] text-text-3 hover:text-text-1">
              查看完整数据表({String(board.rows.length)} 个模型)
            </summary>
            <div className="mt-2">
              <HfTable board={board} />
            </div>
          </details>
        </>
      ) : (
        <>
          <p className="mt-3 rounded-sm border border-line bg-panel-2 px-3 py-2 text-[12px] text-text-3">
            下载量与点赞数将于下次采集后展示,当前先给出完整名次表。
          </p>
          <div className="mt-2">
            <HfTable board={board} />
          </div>
        </>
      )}
    </BoardFrame>
  );
}
