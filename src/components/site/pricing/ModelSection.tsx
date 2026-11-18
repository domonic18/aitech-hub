"use client";

/**
 * 模型牌价面板(M74 批C/D;批G 用途页签;2026-11-18 布局改版):
 * lg+ 屏 = 左侧常驻筛选栏(FilterSidebar)+ 右侧内容;< lg 移动端仍走顶部
 * FilterBar —— 两种形态共用同一份筛选状态。视图三态:列表 | 比价 | 图表
 * (图表 = 输入×输出散点 + 生成价条形图;生成价块仅在有非 token 行时渲染)。
 *
 * **SSR 红线(2026-11-16 空壳事故)**:列表视图渲染**全量行**,被筛掉的行用
 * `hidden` 属性藏住——首屏 HTML 永远含未筛选全量(SEO 生命线),页仍 ISR 静态;
 * 比价/散点是交互视图,只装配可见行。
 *
 * 批G 单位感知:非 token 行(按张/按秒)的 outputPrice 是「生成价」,价格格带
 * 中文后缀;排序/区间按代表价(token=输入价、非 token=生成价)。
 * 免费有两个语义,展示上必须分开:
 * - **完全免费**(is_free):调用不花钱 → 行级绿色「免费」角标
 * - **有免费额度**(free_tier):如「每日 200 万 tokens 免费」→ 橙色额度原文(不叫免费)
 */
import { useMemo } from "react";

import {
  filterModelRows,
  formatPrice,
  isTokenPriced,
  MODEL_CAT_OPTIONS,
  sortModelRows,
  sortPublicModels,
  vendorOptions,
  type ContextBandId,
  type FreeScopeId,
  type ModelCatId,
  type ModelSortId,
  type PriceBandId,
  type PublicModelRow,
} from "@/lib/pricing/public";
import { buildCompareGroups, countComparableModels } from "@/lib/pricing/compare";
import { modelAnchorId } from "@/lib/pricing/jsonld";
import type { PricingViewId } from "@/lib/pricing/query";

import { CompareMatrix } from "./CompareMatrix";
import { FilterBar } from "./FilterBar";
import { FilterSidebar } from "./FilterSidebar";
import { ModelFilters } from "./ModelFilters";
import { OfficialLink, groupKey, groupTitle } from "./shared";
import { PriceScatter } from "./PriceScatter";
import { UnitPriceBars } from "./UnitPriceBars";

/** 完全免费角标 */
function FreeBadge(): React.ReactElement {
  return (
    <span className="ml-1.5 rounded border border-green/40 bg-green/10 px-1.5 py-0.5 align-middle text-[10.5px] leading-none text-green-hi">
      免费
    </span>
  );
}

/** 行可见键(与 React key 同构) */
function rowKey(r: PublicModelRow): string {
  return `${r.vendor}|${r.modelKey}`;
}

function ModelTable({
  rows,
  visibleKeys,
}: {
  rows: PublicModelRow[];
  visibleKeys: Set<string>;
}): React.ReactElement {
  return (
    <div className="hidden sm:block">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line text-[11px] font-normal text-text-3">
            <th className="px-4 py-2.5 font-normal">模型 / 厂商</th>
            <th className="px-3 py-2.5 font-normal">输入价</th>
            <th className="px-3 py-2.5 font-normal">输出价{genPriceNote(rows)}</th>
            <th className="px-3 py-2.5 font-normal">免费额度</th>
            <th className="px-3 py-2.5 font-normal">上下文</th>
            <th className="px-3 py-2.5 font-normal">数据截至</th>
            <th className="px-4 py-2.5 text-right font-normal">来源</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              id={modelAnchorId(r.vendor, r.modelKey)}
              hidden={!visibleKeys.has(rowKey(r))}
              className="border-b border-line/50 last:border-0"
            >
              <td className="px-4 py-3.5">
                <div className="font-mono text-[13px] font-semibold text-text-1">
                  {r.modelKey}
                  {r.isFree && <FreeBadge />}
                </div>
                <div className="mt-0.5 text-[11px] text-text-3">
                  {r.providerName ?? r.vendor}
                  {r.providerKind === "aggregator" && (
                    <span className="ml-1 text-amber">聚合挂牌</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-3.5 font-mono text-text-1">
                {isTokenPriced(r) ? (
                  formatPrice(r.inputPrice, r.currency)
                ) : r.inputPrice === null ? (
                  <span className="text-text-3">—</span>
                ) : (
                  formatPrice(r.inputPrice, r.currency, r.priceUnit)
                )}
              </td>
              <td className="px-3 py-3.5 font-mono text-text-1">
                {formatPrice(r.outputPrice, r.currency, r.priceUnit)}
              </td>
              <td className="px-3 py-3.5 text-[12px]">
                {r.freeTier === null ? (
                  <span className="text-text-3">—</span>
                ) : (
                  <span className="text-amber">{r.freeTier}</span>
                )}
              </td>
              <td className="px-3 py-3.5 font-mono text-[12px] text-text-3">
                {r.contextWindow ?? "—"}
              </td>
              <td className="px-3 py-3.5 font-mono text-[12px] text-text-3">
                {r.dataAsOf.slice(5)}
              </td>
              <td className="px-4 py-3.5 text-right">
                <OfficialLink url={r.sourceUrl} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 组内含非 token 行时,输出价列头补「(生成价·单位)」说明 */
function genPriceNote(rows: PublicModelRow[]): string {
  const hasNonToken = rows.some((r) => !isTokenPriced(r));
  if (!hasNonToken) return "";
  return "(非 token 行=生成价)";
}

function ModelCards({
  rows,
  visibleKeys,
}: {
  rows: PublicModelRow[];
  visibleKeys: Set<string>;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-3 p-3 sm:hidden">
      {rows.map((r) => (
        <div
          key={rowKey(r)}
          hidden={!visibleKeys.has(rowKey(r))}
          className="rounded-lg border border-line/70 px-4 py-3"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[13px] font-semibold text-text-1">
              {r.modelKey}
              {r.isFree && <FreeBadge />}
            </span>
            <OfficialLink url={r.sourceUrl} />
          </div>
          <div className="mt-0.5 text-[11px] text-text-3">
            {r.providerName ?? r.vendor}
            {r.providerKind === "aggregator" && <span className="ml-1 text-amber">聚合挂牌</span>}
          </div>
          <div className="mt-2 flex gap-5 font-mono text-[13px] text-text-1">
            {isTokenPriced(r) && (
              <span>
                <span className="mr-1 text-[10.5px] font-normal text-text-3">输入</span>
                {formatPrice(r.inputPrice, r.currency)}
              </span>
            )}
            <span>
              <span className="mr-1 text-[10.5px] font-normal text-text-3">
                {isTokenPriced(r) ? "输出" : "生成价"}
              </span>
              {formatPrice(r.outputPrice, r.currency, r.priceUnit)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-3">
            {r.freeTier !== null && <span className="text-amber">免费额度:{r.freeTier}</span>}
            {r.contextWindow !== null && <span>上下文 {r.contextWindow}</span>}
            <span>截至 {r.dataAsOf}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 用途分组口径说明(价格标签) */
function catPriceLabel(cat: ModelCatId): string {
  if (cat === "text" || cat === "all") return "输入价 · 每百万 tokens(原币)";
  if (cat === "image") return "生成价 · 元/张(原币)";
  if (cat === "video") return "生成价 · 元/秒(原币)";
  return "代表价(原币)";
}

export interface ModelSectionProps {
  models: PublicModelRow[];
  selectedVendors: string[];
  onVendorsChange: (v: string[]) => void;
  band: PriceBandId;
  onBandChange: (b: PriceBandId) => void;
  /** 免费口径(单选四态:全部/完全免费/有免费额度/任一免费) */
  freeScope: FreeScopeId;
  onFreeScopeChange: (v: FreeScopeId) => void;
  /** 用途分组(批G;切换时上下文档对非文本组自动复位) */
  cat: ModelCatId;
  onCatChange: (v: ModelCatId) => void;
  contextBand: ContextBandId;
  onContextBandChange: (v: ContextBandId) => void;
  sourceKind: string;
  onSourceKindChange: (v: string) => void;
  sort: ModelSortId;
  onSortChange: (v: ModelSortId) => void;
  /** 模型区视图:列表 | 比价(M74 批D) */
  view: PricingViewId;
  onViewChange: (v: PricingViewId) => void;
}

export function ModelSection({
  models,
  selectedVendors,
  onVendorsChange,
  band,
  onBandChange,
  freeScope,
  onFreeScopeChange,
  cat,
  onCatChange,
  contextBand,
  onContextBandChange,
  sourceKind,
  onSourceKindChange,
  sort,
  onSortChange,
  view,
  onViewChange,
}: ModelSectionProps): React.ReactElement {
  // 批D8:筛选/排序/分面全部 memo 化——此前每次渲染(任意 chip 点击)都重算
  // 两遍筛选 + 两遍排序 + 厂商分面;聚合源铺开后行数百级,这是主交互卡顿源
  const sortedModels = useMemo(() => sortPublicModels(models), [models]);
  const visible = useMemo(
    () =>
      sortModelRows(
        filterModelRows(sortedModels, {
          vendors: selectedVendors,
          band,
          freeScope,
          cat,
          contextBand,
          sourceKind,
        }),
        sort,
      ),
    [sortedModels, selectedVendors, band, freeScope, cat, contextBand, sourceKind, sort],
  );
  const visibleKeys = useMemo(() => new Set(visible.map(rowKey)), [visible]);
  // 全量行仍渲染(筛掉的 hidden 藏住):首屏 HTML 含未筛选全量(SEO 红线)
  const allRows = useMemo(() => sortModelRows(sortedModels, sort), [sortedModels, sort]);
  // 当前用途组的行(厂商分面同口径:只按用途组一维收边,不受其余筛选影响)
  const catRows = useMemo(
    () =>
      filterModelRows(sortedModels, {
        vendors: [],
        band: "all",
        freeScope: "all",
        cat,
        contextBand: "all",
        sourceKind: "",
      }),
    [sortedModels, cat],
  );
  // 各免费口径的行数(筛选器带计数:让用户先看到「有多少行」再选)。
  // **按当前用途组收边**(与厂商分面同口径)——否则「完全免费 1」点下去在
  // 「文本」页签是 0 行(那 1 行是图片模型),计数与结果对不上,像数据丢了
  const freeCounts = useMemo(() => {
    const counts: Record<FreeScopeId, number> = { all: 0, full: 0, quota: 0, any: 0 };
    for (const m of catRows) {
      counts.all += 1;
      if (m.isFree) counts.full += 1;
      if (m.freeTier !== null && m.freeTier.trim() !== "") counts.quota += 1;
      if (m.isFree || (m.freeTier !== null && m.freeTier.trim() !== "")) counts.any += 1;
    }
    return counts;
  }, [catRows]);
  const tokenCat = cat === "text" || cat === "all";
  // 厂商选项按当前用途组收边(facet,2026-11-18 反馈:文本页签里勾「词元所·
  // 爱诗科技」零结果——它是视频-only 厂商,清单却按全量行生成,勾了必空筛,
  // 用户以为数据丢了)。仅按用途组一维收边,不受其余筛选影响(清单稳定)
  const vendorFacet = useMemo(() => vendorOptions(catRows, (r) => r.vendor), [catRows]);
  const rowGroups = useMemo(() => allRowGroups(allRows, visibleKeys), [allRows, visibleKeys]);
  const compareGroups = useMemo(
    () => (view === "compare" ? buildCompareGroups(visible) : []),
    [view, visible],
  );
  const comparableCount = useMemo(
    () => (view === "compare" ? countComparableModels(visible) : 0),
    [view, visible],
  );
  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-line bg-panel shadow-sm">
      {/* 用途页签(批G)+ 视图切换(M74 批D) */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel-2/30 px-4 py-2">
        <span className="mr-1 text-[11px] text-text-3">用途</span>
        {MODEL_CAT_OPTIONS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={cat === c.id}
            onClick={() => onCatChange(c.id)}
            className={`rounded-full border px-2.5 py-1 text-[11.5px] leading-none transition-colors cursor-pointer select-none ${
              cat === c.id
                ? "border-accent bg-accent text-white"
                : "border-line bg-panel text-text-2 hover:border-line-hover hover:text-text-1"
            }`}
          >
            {c.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {(
            [
              { id: "list" as const, label: "列表" },
              { id: "compare" as const, label: "比价" },
              { id: "charts" as const, label: "图表" },
            ] satisfies Array<{ id: PricingViewId; label: string }>
          ).map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              onClick={() => onViewChange(v.id)}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] leading-none transition-colors cursor-pointer select-none ${
                view === v.id
                  ? "border-accent bg-accent text-white"
                  : "border-line bg-panel text-text-2 hover:border-line-hover hover:text-text-1"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {view === "compare" && (
          <span className="w-full text-[11px] text-text-3">
            {comparableCount} 个模型有 ≥2 家报价可并排比
          </span>
        )}
      </div>
      {/* lg+:左侧常驻筛选栏(2026-11-18 反馈问题一);<lg:顶部 FilterBar,同一份状态 */}
      <div className="lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
        <div className="hidden lg:block">
          <FilterSidebar
            cat={cat}
            onCatChange={onCatChange}
            vendors={vendorFacet}
            selectedVendors={selectedVendors}
            onVendorsChange={onVendorsChange}
            band={band}
            onBandChange={onBandChange}
            contextBand={contextBand}
            onContextBandChange={onContextBandChange}
            sourceKind={sourceKind}
            onSourceKindChange={onSourceKindChange}
            freeScope={freeScope}
            onFreeScopeChange={onFreeScopeChange}
            freeCounts={freeCounts}
            sort={sort}
            onSortChange={onSortChange}
            priceLabel={catPriceLabel(cat)}
            total={models.length}
            shown={visible.length}
          />
        </div>
        <div className="min-w-0">
          <div className="lg:hidden">
            <FilterBar
              vendors={vendorFacet}
              selectedVendors={selectedVendors}
              onVendorsChange={onVendorsChange}
              band={band}
              onBandChange={onBandChange}
              priceLabel={catPriceLabel(cat)}
              total={models.length}
              shown={visible.length}
              freeScope={{ value: freeScope, onChange: onFreeScopeChange, counts: freeCounts }}
              extra={
                <ModelFilters
                  cat={cat}
                  contextBand={contextBand}
                  onContextBandChange={onContextBandChange}
                  sourceKind={sourceKind}
                  onSourceKindChange={onSourceKindChange}
                  sort={sort}
                  onSortChange={onSortChange}
                />
              }
            />
          </div>
          {view === "charts" ? (
            <>
              <div className="border-t border-line">
                <div className="border-b border-line px-4 py-3">
                  <h2 className="text-[13px] font-semibold text-text-1">输入价 × 输出价</h2>
                  <p className="mt-1 text-[11.5px] text-text-3">
                    每个点 = 一个模型最便宜的一家;左下 = 输入输出都便宜。对数刻度(仅 token
                    计价模型;按张/按秒模型看下方条形图)。
                  </p>
                </div>
                <PriceScatter rows={visible} />
              </div>
              {/* 仅当前筛选含非 token 行(按张/按秒)时渲染:文本页签没有此类行,整块
                  不出现(2026-11-18 反馈:孤零零一条「videoretalk」很怪——那是模态
                  误判进文本组的视频模型,关键词修后由日采自愈归组) */}
              {visible.some((r) => !isTokenPriced(r)) && (
                <div className="border-t border-line">
                  <div className="border-b border-line px-4 py-3">
                    <h2 className="text-[13px] font-semibold text-text-1">生成价对比(按张/按秒)</h2>
                    <p className="mt-1 text-[11.5px] text-text-3">
                      每条 = 一个模型最便宜一家的生成价;按 币种 × 单位 分块,条长线性归一。
                    </p>
                  </div>
                  <UnitPriceBars rows={visible} />
                </div>
              )}
            </>
          ) : view === "compare" ? (
            <>
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-[13px] font-semibold text-text-1">同模型跨提供商比价</h2>
                <p className="mt-1 text-[11.5px] text-text-3">
                  按模型归一后并排各家报价,组内按价格升序,「最低」标最低价的一家;
                  原币直出不折算、token 与按张/按秒量纲不同,各归各区、只在区内比价。
                </p>
              </div>
              <CompareMatrix groups={compareGroups} />
              <div className="border-t border-line">
                <div className="border-b border-line px-4 py-3">
                  <h2 className="text-[13px] font-semibold text-text-1">价格分布</h2>
                  <p className="mt-1 text-[11.5px] text-text-3">
                    每个点 = 一个模型**最便宜的一家**报价;左下 = 输入输出都便宜。坐标为对数刻度 (仅
                    token 计价模型;按张/按秒模型看下方条形图)。
                  </p>
                </div>
                <PriceScatter rows={visible} />
              </div>
              <div className="border-t border-line">
                <div className="border-b border-line px-4 py-3">
                  <h2 className="text-[13px] font-semibold text-text-1">生成价对比(按张/按秒)</h2>
                  <p className="mt-1 text-[11.5px] text-text-3">
                    每条 = 一个模型最便宜一家的生成价;按 币种 × 单位 分块,条长线性归一。
                  </p>
                </div>
                <UnitPriceBars rows={visible} />
              </div>
            </>
          ) : (
            rowGroups.map(({ key, rows, count }) => (
              <div
                key={key}
                // 批D8:全量行必须进 DOM(SEO 红线),但视口外的分组可跳过布局绘制
                className="border-b border-line last:border-b-0 [content-visibility:auto] [contain-intrinsic-size:auto_600px]"
              >
                <div className="flex items-center gap-2 border-b border-line bg-panel-2/50 px-4 py-3">
                  <h2 className="text-[13px] font-semibold text-text-1">{groupTitle(key, rows)}</h2>
                  <span className="ml-auto font-mono text-[11px] text-blue">{count}</span>
                </div>
                <ModelTable rows={rows} visibleKeys={visibleKeys} />
                <ModelCards rows={rows} visibleKeys={visibleKeys} />
              </div>
            ))
          )}
        </div>
      </div>
      {visible.length > 0 && (
        <p className="border-t border-line px-4 py-3 text-[11.5px] text-text-3">
          共 {visible.length} 个模型 · v1 覆盖 {new Set(visible.map((m) => m.vendor)).size}{" "}
          家官方厂牌 · 完整列表随官方调价滚动更新
        </p>
      )}
      {!tokenCat && visible.length === 0 && (
        <p className="border-t border-line px-4 py-6 text-center text-[12px] text-text-3">
          该用途分组暂无已上架数据(新源采集后经人工终审上架)
        </p>
      )}
    </div>
  );
}

/** 列表分组:全量行分组 + 组内可见计数(0 可见的组整组不渲染) */
function allRowGroups(
  allRows: PublicModelRow[],
  visibleKeys: Set<string>,
): Array<{ key: string; rows: PublicModelRow[]; count: number }> {
  const keys = [...new Set(allRows.map(groupKey))];
  return keys
    .map((key) => {
      const rows = allRows.filter((m) => groupKey(m) === key);
      return { key, rows, count: rows.filter((m) => visibleKeys.has(rowKey(m))).length };
    })
    .filter((g) => g.count > 0);
}
