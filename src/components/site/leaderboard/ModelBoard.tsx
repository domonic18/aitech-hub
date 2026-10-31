/**
 * 模型榜(M63):智能指数(散点)与 Hugging Face 趋势(横条)合并为一节,
 * 双子页签用 CSS :checked 单选实现——零客户端 JS、两栏都进 SSR HTML,
 * 不读 searchParams(读即转动态渲染,ISR 失效)。
 * 价格未采到/样本不足时散点自动退化为完整表 + 补采提示,绝不画空图。
 */
import type { PublicLeaderboard } from "@/lib/leaderboard/public";
import { buildScatterGeometry, type ScatterInput } from "@/lib/leaderboard/scatter";

import { BoardFrame } from "./BoardFrame";
import { ModelScatter } from "./ModelScatter";
import { ModelTable } from "./ModelTable";
import { TrendingBars } from "./TrendingBars";

function toScatterInputs(board: PublicLeaderboard): ScatterInput[] {
  return board.rows.map((r) => ({
    key: r.entityKey,
    name: r.entityName === "" ? r.entityKey : r.entityName,
    vendor: r.vendor,
    intelligence: r.score,
    outputPrice: r.extra.price1mOutputTokens ?? null,
    openWeights: r.extra.isOpenWeights ?? null,
    rank: r.rank,
  }));
}

const TAB_LABEL =
  "cursor-pointer rounded-sm px-3 py-1.5 text-[12.5px] text-text-2 hover:text-text-1";

function IndexPanel({ board }: { board: PublicLeaderboard }): React.ReactElement {
  const geometry = buildScatterGeometry(toScatterInputs(board));
  const canScatter = geometry.points.length >= 2;
  return (
    <>
      {canScatter ? (
        <ModelScatter geometry={geometry} rows={board.rows} hasPrevious={board.hasPrevious} />
      ) : (
        <>
          <p className="mt-3 rounded-sm border border-line bg-panel-2 px-3 py-2 text-[12px] text-text-3">
            价格数据将于下次采集后展示,当前先给出完整名次表。
          </p>
          <div className="mt-2">
            <ModelTable rows={board.rows} hasPrevious={board.hasPrevious} />
          </div>
        </>
      )}
      {canScatter && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[12px] text-text-3 hover:text-text-1">
            查看完整数据表({board.rows.length} 个模型)
          </summary>
          <div className="mt-2">
            <ModelTable rows={board.rows} hasPrevious={board.hasPrevious} />
          </div>
        </details>
      )}
    </>
  );
}

export function ModelBoard({
  index,
  trending,
}: {
  index: PublicLeaderboard | null;
  trending: PublicLeaderboard | null;
}): React.ReactElement | null {
  const boards = [index, trending].filter((b): b is PublicLeaderboard => b !== null);
  if (boards.length === 0) return null;

  const capturedDate = boards.reduce<string | null>(
    (acc, b) => (acc === null || b.capturedDate > acc ? b.capturedDate : acc),
    null,
  );
  const staleDays = Math.max(0, ...boards.map((b) => b.staleDays));

  return (
    <BoardFrame
      id="models"
      title="模型榜"
      hint="智能指数越高越强,输出价越低越便宜——左上角是「又强又便宜」的模型;趋势榜看社区当下在用哪些模型。"
      capturedDate={capturedDate}
      staleDays={staleDays}
      sources={boards.map((b) => ({ label: b.label, url: b.sourceUrl }))}
    >
      {index !== null && trending !== null ? (
        <div className="mt-4">
          <div role="radiogroup" aria-label="模型榜视图" className="flex flex-wrap gap-1.5">
            <input
              id="model-tab-aa"
              type="radio"
              name="model-board-tab"
              defaultChecked
              className="peer/aa sr-only"
            />
            <label
              id="model-tab-aa-label"
              htmlFor="model-tab-aa"
              className={`${TAB_LABEL} peer-checked/aa:bg-accent-dim peer-checked/aa:text-accent peer-focus-visible/aa:ring-2 peer-focus-visible/aa:ring-accent`}
            >
              智能指数
            </label>
            <input
              id="model-tab-hf"
              type="radio"
              name="model-board-tab"
              className="peer/hf sr-only"
            />
            <label
              id="model-tab-hf-label"
              htmlFor="model-tab-hf"
              className={`${TAB_LABEL} peer-checked/hf:bg-accent-dim peer-checked/hf:text-accent peer-focus-visible/hf:ring-2 peer-focus-visible/hf:ring-accent`}
            >
              模型趋势
            </label>
            <div
              role="region"
              aria-labelledby="model-tab-aa-label"
              className="hidden w-full peer-checked/aa:block"
            >
              <IndexPanel board={index} />
            </div>
            <div
              role="region"
              aria-labelledby="model-tab-hf-label"
              className="hidden w-full peer-checked/hf:block"
            >
              <TrendingBars rows={trending.rows} hasPrevious={trending.hasPrevious} />
            </div>
          </div>
        </div>
      ) : index !== null ? (
        <IndexPanel board={index} />
      ) : trending !== null ? (
        <TrendingBars rows={trending.rows} hasPrevious={trending.hasPrevious} />
      ) : null}
    </BoardFrame>
  );
}
