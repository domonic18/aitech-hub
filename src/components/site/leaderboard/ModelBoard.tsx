/**
 * 模型能力与价格(M63 v2):二维散点——纵轴能力分、横轴输出价格(对数),
 * 左上角 = 又强又便宜。价格未采到/样本不足时自动退化为完整表 + 补采提示,
 * 绝不画空图;出图时完整表折进 <details>(AA 最多 60 行)。
 *
 * 双币切换(M63 v2.1):radio + CSS :has() 零 JS(本页 ISR 3600s,读 searchParams
 * 会转动态渲染);两套刻度/价格文本同时进 HTML,默认人民币。人民币是上游 USD
 * 报价的**展示折算**,始终标汇率与日期——定价模块的「不做汇率折算」立场不变。
 */
import { formatCompact, formatCnyPrice, formatPrice, formatScore } from "@/lib/leaderboard/format";
import { FX_RATE_FALLBACK, FX_RATE_SOURCE_URL, type UsdCnyRate } from "@/lib/leaderboard/fx";
import type { PublicLeaderboard } from "@/lib/leaderboard/public";
import { buildScatterGeometry } from "@/lib/leaderboard/scatter";
import { modelScatterData, modelScatterOptions } from "@/lib/leaderboard/scatter-data";

import { BoardFrame } from "./BoardFrame";
import { ModelTable } from "./ModelTable";
import { ScatterChart } from "./ScatterChart";
import { DeltaMark, EntityLink } from "./shared";

const HINT =
  "横轴是输出价格(越靠左越便宜),纵轴是能力分(越高越强)——左上角就是「又强又便宜」。能力分与输出价均取自 Artificial Analysis 智能指数榜(原站按美元 / 1M tokens 报价,人民币为折算展示);空心点是开源权重的模型,颜色区分厂商。";

/** 币种切换(非受控 radio;状态归 CSS,SSR 零 hydration) */
function CurrencyToggle({ fx }: { fx: UsdCnyRate }): React.ReactElement {
  const note = fx.isFallback
    ? `按默认汇率折算(1 USD ≈ ¥${String(FX_RATE_FALLBACK)}),每日自动采集生效后更新`
    : `按 ${fx.date ?? "最近一次"} 汇率折算 · 1 USD ≈ ¥${String(fx.rate)} · 仅供参考`;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-[11px] text-text-3">价格单位</span>
      <div
        role="radiogroup"
        aria-label="输出价格单位"
        className="inline-flex items-center gap-0.5 rounded-sm bg-panel-2 p-0.5"
      >
        <input
          id="lb-cur-cny"
          type="radio"
          name="lb-currency"
          defaultChecked
          className="peer/cny sr-only"
        />
        <input id="lb-cur-usd" type="radio" name="lb-currency" className="peer/usd sr-only" />
        <label
          htmlFor="lb-cur-cny"
          className="cursor-pointer rounded-[3px] px-2.5 py-1 text-[12px] text-text-3 transition-colors peer-checked/cny:bg-panel peer-checked/cny:text-text-1 peer-focus-visible/cny:ring-1 peer-focus-visible/cny:ring-accent"
        >
          人民币 ¥
        </label>
        <label
          htmlFor="lb-cur-usd"
          className="cursor-pointer rounded-[3px] px-2.5 py-1 text-[12px] text-text-3 transition-colors peer-checked/usd:bg-panel peer-checked/usd:text-text-1 peer-focus-visible/usd:ring-1 peer-focus-visible/usd:ring-accent"
        >
          美元 $
        </label>
      </div>
      <span className="cur-cny text-[11px] text-text-3">
        {note}
        {!fx.isFallback && (
          <>
            {" · "}
            <a
              href={FX_RATE_SOURCE_URL}
              target="_blank"
              rel="nofollow noopener noreferrer"
              className="underline decoration-line hover:text-text-1"
            >
              汇率来源 {fx.source ?? "open.er-api.com"}
            </a>
          </>
        )}
      </span>
    </div>
  );
}

/** tooltip 价格行:人民币为主、美元原文在括号里(悬停即两币可对照) */
function tooltipPrice(usd: number | null | undefined, rate: number): string {
  if (usd === null || usd === undefined) return "";
  if (usd === 0) return "输出价 免费 / 1M tokens";
  return `输出价 ${formatCnyPrice(usd * rate)}(${formatPrice(usd)}) / 1M tokens`;
}

/** 移动端单价 chip(两币同渲染,由币种开关控制显隐) */
function PriceChip({
  usd,
  rate,
  suffix,
}: {
  usd: number | null | undefined;
  rate: number;
  suffix?: string;
}): React.ReactElement | null {
  if (usd === null || usd === undefined) return null;
  return (
    <span className="font-mono text-amber">
      <span className="cur-cny">{formatCnyPrice(usd * rate)}</span>
      <span className="cur-usd">{formatPrice(usd)}</span>
      {suffix === undefined ? "" : ` / ${suffix}`}
    </span>
  );
}

function MobileList({
  board,
  rate,
}: {
  board: PublicLeaderboard;
  rate: number;
}): React.ReactElement {
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
                <span className="font-mono">能力分 {formatScore(row.score, null)}</span>
                <PriceChip usd={row.extra.price1mOutputTokens} rate={rate} suffix="1M out" />
              </span>
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ModelBoard({
  board,
  fx,
}: {
  board: PublicLeaderboard;
  fx: UsdCnyRate;
}): React.ReactElement {
  // 点位与域宽与币种无关(对数轴乘常数),几何只算一次;美元刻度另算一份只为刻度文本
  const data = modelScatterData(board, fx.rate);
  const geometry = buildScatterGeometry(data, modelScatterOptions("cny"));
  const canScatter = geometry.points.length >= 2;
  const usdTicks = canScatter
    ? buildScatterGeometry(modelScatterData(board, 1), modelScatterOptions("usd")).xTicks
    : [];

  return (
    <BoardFrame
      id="models"
      title="模型能力与价格"
      hint={HINT}
      capturedDate={board.capturedDate}
      staleDays={board.staleDays}
      sources={[{ label: board.label, url: board.sourceUrl }]}
    >
      {canScatter ? (
        <>
          <CurrencyToggle fx={fx} />
          <ScatterChart
            geometry={geometry}
            data={data}
            rows={board.rows}
            ariaLabel="模型能力与输出价格散点图,左上角为能力高、价格低"
            xTitle="输出价格(对数轴 · 每 1M tokens)"
            yTitle="能力分(AAII · 越高越强)"
            quadLabel="又强又便宜"
            legendNote="空心 = 开源权重"
            missingNote={
              geometry.missingCount > 0
                ? `${String(geometry.missingCount)} 个模型未公布输出价格,未绘入散点`
                : null
            }
            tooltip={(row, p) => [
              p.name,
              p.vendor ?? "",
              `能力分 ${formatScore(p.y, null)}`,
              tooltipPrice(row?.extra.price1mOutputTokens, fx.rate),
              formatCompact(row?.extra.contextWindowTokens) === ""
                ? ""
                : `上下文 ${formatCompact(row?.extra.contextWindowTokens)}`,
              p.hollow ? "开源权重" : "",
            ]}
            xTicksAlt={usdTicks}
            mobile={<MobileList board={board} rate={fx.rate} />}
          />
          <details className="mt-4">
            <summary className="cursor-pointer text-[12px] text-text-3 hover:text-text-1">
              查看完整数据表({String(board.rows.length)} 个模型)
            </summary>
            <div className="mt-2">
              <ModelTable rows={board.rows} hasPrevious={board.hasPrevious} rate={fx.rate} />
            </div>
          </details>
        </>
      ) : (
        <>
          <p className="mt-3 rounded-sm border border-line bg-panel-2 px-3 py-2 text-[12px] text-text-3">
            价格数据将于下次采集后展示,当前先给出完整名次表。
          </p>
          <div className="mt-2">
            <ModelTable rows={board.rows} hasPrevious={board.hasPrevious} rate={fx.rate} />
          </div>
        </>
      )}
    </BoardFrame>
  );
}
