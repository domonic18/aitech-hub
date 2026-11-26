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
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { type ContextBandId } from "@/lib/pricing/context";
import {
  filterModelRows,
  formatPrice,
  isTokenPriced,
  MODEL_CAT_OPTIONS,
  sortModelRows,
  sortPublicModels,
  vendorOptions,
  type FreeScopeId,
  type ModelCatId,
  type ModelSortId,
  type PriceBandId,
  type PublicModelRow,
  type TierParamFilter,
} from "@/lib/pricing/public";
import { modelAnchorId } from "@/lib/pricing/jsonld";
import type { ApiProtocol } from "@/lib/pricing/protocols";
import type { PricingViewId } from "@/lib/pricing/query";
import {
  formatScenarioCost,
  scenarioCost,
  scenarioOptions,
  type PricingScenarioId,
} from "@/lib/pricing/scenario";
import type { LeaderboardBadge } from "@/lib/pricing/leaderboard-ref";

import { ActiveFilterChips } from "./ActiveFilterChips";
import { ParamFilterGroup } from "./ParamFilterGroup";
import { PriceRangeInput } from "./PriceRangeInput";
import { SearchBox } from "./SearchBox";
import { FilterBar } from "./FilterBar";
import { FilterSidebar } from "./FilterSidebar";
import { ModelFilters } from "./ModelFilters";
import { OfficialLink, groupKey, groupTitle, ProtocolBadges } from "./shared";
import { PriceScatter } from "./PriceScatter";
import { basisResolution, ResolutionLadder } from "./ResolutionLadder";
import { UnitPriceBars } from "./UnitPriceBars";

/** 完全免费角标 */
function FreeBadge(): React.ReactElement {
  return (
    <span className="ml-1.5 rounded border border-green/40 bg-green/10 px-1.5 py-0.5 align-middle text-[10.5px] leading-none text-green-hi">
      免费
    </span>
  );
}

/** 对比勾选框:满额时未选中行禁用,与 Coding Plan CompareCheck 同构 */
function CompareCheck({
  checked,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <label
      className="-m-2 flex cursor-pointer items-center p-2"
      title={disabled ? "对比最多 4 个,先移除已选项" : "加入对比"}
    >
      <input
        type="checkbox"
        className="h-4 w-4 cursor-pointer accent-accent disabled:cursor-not-allowed"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        aria-label={`把 ${label} 加入对比`}
      />
    </label>
  );
}

/** 行可见键(与 React key 同构) */
function rowKey(r: PublicModelRow): string {
  return `${r.vendor}|${r.modelKey}`;
}

/** 型号组键(能力归一键):跨厂商同型号、同型号多版本快照归一组 */
function modelGroupKey(r: PublicModelRow): string {
  return r.modelGroupKey ?? r.modelDictKey ?? `${r.vendor}|${r.modelKey}`;
}

/** 型号组展示名 */
function modelGroupName(rows: PublicModelRow[]): string {
  const r = rows[0];
  return r.modelDisplayName ?? r.modelDictKey ?? r.modelKey;
}

function ModelTable({
  modelGroups,
  visibleKeys,
  onToggleGroup,
  modelCompareKeys,
  onToggleModelCompare,
  modelCompareLimit,
  scenario,
  leaderboardMap,
}: {
  modelGroups: ModelGroupDef[];
  visibleKeys: Set<string>;
  onToggleGroup: (g: ModelGroupDef) => void;
  modelCompareKeys: string[];
  onToggleModelCompare: (key: string) => void;
  modelCompareLimit: number;
  scenario: PricingScenarioId;
  leaderboardMap: Map<string, LeaderboardBadge[]>;
}): React.ReactElement {
  const showScenario = scenario !== "off";
  const colSpan = showScenario ? 8 : 7;
  return (
    <div className="hidden overflow-x-auto sm:block">
      {/* table-fixed + 显式列宽:免费额度原文可很长(「共100万tokens…资源包有效期1年…」),
          auto 布局会把它算成整列 max-content 宽度 → 挤得其余列表头折行(2026-11-20 反馈)。
          固定布局后各列宽由 colgroup 决定,长文在额度列内换行,不再外溢 */}
      <table className="w-full min-w-[860px] table-fixed text-left text-[13px]">
        <colgroup>
          <col className="w-14" />
          <col className="w-[26%]" />
          <col className="w-[8%]" />
          <col className="w-[8%]" />
          {showScenario && <col className="w-[10%]" />}
          <col className="w-[22%]" />
          <col className="w-[8%]" />
          <col className="w-[8%]" />
          <col className="w-[10%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line text-[11px] font-normal text-text-3">
            <th className="px-4 py-2.5 font-normal whitespace-nowrap">比价</th>
            <th className="px-3 py-2.5 font-normal whitespace-nowrap">模型 / 厂商</th>
            <th className="px-3 py-2.5 font-normal whitespace-nowrap">输入价</th>
            <th className="px-3 py-2.5 font-normal whitespace-nowrap">输出价</th>
            {showScenario && <th className="px-3 py-2.5 font-normal whitespace-nowrap">场景价</th>}
            <th className="px-3 py-2.5 font-normal whitespace-nowrap">免费额度</th>
            <th className="px-3 py-2.5 font-normal whitespace-nowrap">上下文</th>
            <th className="px-3 py-2.5 font-normal whitespace-nowrap">数据截至</th>
            <th className="px-4 py-2.5 text-right font-normal whitespace-nowrap">来源</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={colSpan} className="px-4 py-1.5 text-[10.5px] text-text-3">
              价格单位:token 模型 = 元/百万 tokens;按张/按秒模型 = 生成价(单位见行内后缀)。
              图片/视频按分辨率分档,行价对应最低分辨率档(行内已注明),其余分辨率价见模型名
              下的折叠档位。
            </td>
          </tr>
          {modelGroups.map((mg) => (
            <Fragment key={mg.key}>
              <tr className="border-b border-line bg-panel-2/30">
                <td colSpan={colSpan} className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => onToggleGroup(mg)}
                    className="flex w-full cursor-pointer items-center justify-between text-left text-[13px] font-semibold text-text-1"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-[10px] text-text-3">{mg.expanded ? "▾" : "▸"}</span>
                      {mg.displayName}
                      <span className="rounded-sm border border-line bg-panel px-1.5 py-0.5 text-[10px] font-normal text-text-3">
                        {mg.rows.length} 个版本
                      </span>
                    </span>
                    <span className="font-mono text-[11px] text-blue">{mg.visibleCount}</span>
                  </button>
                </td>
              </tr>
              {mg.rows.map((r) => (
                <ModelTableRow
                  key={rowKey(r)}
                  row={r}
                  hidden={!visibleKeys.has(rowKey(r)) || !mg.expanded}
                  showScenario={showScenario}
                  scenario={scenario}
                  leaderboardMap={leaderboardMap}
                  modelCompareKeys={modelCompareKeys}
                  onToggleModelCompare={onToggleModelCompare}
                  modelCompareLimit={modelCompareLimit}
                />
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelTableRow({
  row,
  hidden,
  showScenario,
  scenario,
  leaderboardMap,
  modelCompareKeys,
  onToggleModelCompare,
  modelCompareLimit,
}: {
  row: PublicModelRow;
  hidden: boolean;
  showScenario: boolean;
  scenario: PricingScenarioId;
  leaderboardMap: Map<string, LeaderboardBadge[]>;
  modelCompareKeys: string[];
  onToggleModelCompare: (key: string) => void;
  modelCompareLimit: number;
}): React.ReactElement {
  const key = rowKey(row);
  const checked = modelCompareKeys.includes(key);
  const full = modelCompareKeys.length >= modelCompareLimit;
  return (
    <tr
      id={modelAnchorId(row.vendor, row.modelKey)}
      hidden={hidden}
      className="border-b border-line/50 last:border-0"
    >
      <td className="px-4 py-3.5 align-top">
        <CompareCheck
          checked={checked}
          disabled={full && !checked}
          label={row.modelKey}
          onToggle={() => onToggleModelCompare(key)}
        />
      </td>
      <td className="px-3 py-3.5">
        <div className="font-mono text-[13px] font-semibold break-words text-text-1">
          {row.modelKey}
          {row.isFree && <FreeBadge />}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-text-3">
          <span>{row.providerName ?? row.vendor}</span>
          {row.providerKind === "aggregator" && <span className="text-amber">聚合</span>}
          <ProtocolBadges protocols={row.protocols} />
          <LeaderboardBadges badges={leaderboardMap.get(row.modelDictKey ?? row.modelKey)} />
        </div>
        <ResolutionLadder row={row} />
      </td>
      <td className="px-3 py-3.5 font-mono text-text-1 whitespace-nowrap">
        {isTokenPriced(row) ? (
          formatPrice(row.inputPrice, row.currency)
        ) : row.inputPrice === null ? (
          <span className="text-text-3">—</span>
        ) : (
          formatPrice(row.inputPrice, row.currency, row.priceUnit)
        )}
      </td>
      <td className="px-3 py-3.5 font-mono text-text-1">
        <span className="whitespace-nowrap">
          {formatPrice(row.outputPrice, row.currency, row.priceUnit)}
        </span>
        {basisResolution(row) !== null && (
          <span className="mt-0.5 block text-[10.5px] font-normal text-text-3">
            {basisResolution(row)} 分辨率
          </span>
        )}
      </td>
      {showScenario && (
        <td className="px-3 py-3.5 font-mono text-[12px] text-text-1 whitespace-nowrap">
          {formatScenarioCost(scenarioCost(row, scenario), row.currency, scenario)}
        </td>
      )}
      <td className="px-3 py-3.5 text-[12px]">
        {row.freeTier === null ? (
          <span className="text-text-3">—</span>
        ) : (
          // 额度原文可能很长(资源包有效期等),列内换行显示,不再撑宽整表
          <span className="block break-words text-amber" title={row.freeTier}>
            {row.freeTier}
          </span>
        )}
      </td>
      <td className="px-3 py-3.5 font-mono text-[12px] text-text-3 whitespace-nowrap">
        {row.contextWindow ?? "—"}
      </td>
      <td className="px-3 py-3.5 font-mono text-[12px] text-text-3 whitespace-nowrap">
        {row.dataAsOf.slice(5)}
      </td>
      <td className="px-4 py-3.5 text-right">
        <OfficialLink url={row.sourceUrl} />
      </td>
    </tr>
  );
}

function ModelCards({
  modelGroups,
  visibleKeys,
  onToggleGroup,
  modelCompareKeys,
  onToggleModelCompare,
  modelCompareLimit,
  scenario,
  leaderboardMap,
}: {
  modelGroups: ModelGroupDef[];
  visibleKeys: Set<string>;
  onToggleGroup: (g: ModelGroupDef) => void;
  modelCompareKeys: string[];
  onToggleModelCompare: (key: string) => void;
  modelCompareLimit: number;
  scenario: PricingScenarioId;
  leaderboardMap: Map<string, LeaderboardBadge[]>;
}): React.ReactElement {
  const showScenario = scenario !== "off";
  return (
    <div className="flex flex-col gap-3 p-3 sm:hidden">
      {modelGroups.map((mg) => {
        return (
          <Fragment key={mg.key}>
            <button
              type="button"
              onClick={() => onToggleGroup(mg)}
              className="flex cursor-pointer items-center justify-between rounded-lg border border-line/70 bg-panel-2/30 px-4 py-2 text-left"
            >
              <span className="flex items-center gap-2 text-[13px] font-semibold text-text-1">
                <span className="text-[10px] text-text-3">{mg.expanded ? "▾" : "▸"}</span>
                {mg.displayName}
                <span className="rounded-sm border border-line bg-panel px-1.5 py-0.5 text-[10px] font-normal text-text-3">
                  {mg.rows.length} 个版本
                </span>
              </span>
              <span className="font-mono text-[11px] text-blue">{mg.visibleCount}</span>
            </button>
            {mg.rows.map((r) => (
              <ModelCard
                key={rowKey(r)}
                row={r}
                hidden={!visibleKeys.has(rowKey(r)) || !mg.expanded}
                showScenario={showScenario}
                scenario={scenario}
                leaderboardMap={leaderboardMap}
                modelCompareKeys={modelCompareKeys}
                onToggleModelCompare={onToggleModelCompare}
                modelCompareLimit={modelCompareLimit}
              />
            ))}
          </Fragment>
        );
      })}
    </div>
  );
}

function ModelCard({
  row,
  hidden,
  showScenario,
  scenario,
  leaderboardMap,
  modelCompareKeys,
  onToggleModelCompare,
  modelCompareLimit,
}: {
  row: PublicModelRow;
  hidden: boolean;
  showScenario: boolean;
  scenario: PricingScenarioId;
  leaderboardMap: Map<string, LeaderboardBadge[]>;
  modelCompareKeys: string[];
  onToggleModelCompare: (key: string) => void;
  modelCompareLimit: number;
}): React.ReactElement {
  const key = rowKey(row);
  const checked = modelCompareKeys.includes(key);
  const full = modelCompareKeys.length >= modelCompareLimit;
  return (
    <div hidden={hidden} className="rounded-lg border border-line/70 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[13px] font-semibold text-text-1">
          {row.modelKey}
          {row.isFree && <FreeBadge />}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <OfficialLink url={row.sourceUrl} />
          <CompareCheck
            checked={checked}
            disabled={full && !checked}
            label={row.modelKey}
            onToggle={() => onToggleModelCompare(key)}
          />
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-text-3">
        <span>{row.providerName ?? row.vendor}</span>
        {row.providerKind === "aggregator" && <span className="text-amber">聚合</span>}
        <ProtocolBadges protocols={row.protocols} />
        <LeaderboardBadges badges={leaderboardMap.get(row.modelDictKey ?? row.modelKey)} />
      </div>
      <div className="mt-2 flex gap-5 font-mono text-[13px] text-text-1">
        {isTokenPriced(row) && (
          <span>
            <span className="mr-1 text-[10.5px] font-normal text-text-3">输入</span>
            {formatPrice(row.inputPrice, row.currency)}
          </span>
        )}
        <span>
          <span className="mr-1 text-[10.5px] font-normal text-text-3">
            {isTokenPriced(row) ? "输出" : "生成价"}
          </span>
          {formatPrice(row.outputPrice, row.currency, row.priceUnit)}
        </span>
        {showScenario && (
          <span>
            <span className="mr-1 text-[10.5px] font-normal text-text-3">场景价</span>
            {formatScenarioCost(scenarioCost(row, scenario), row.currency, scenario)}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-3">
        {isTokenPriced(row) && <span>元/百万 tokens</span>}
        {basisResolution(row) !== null && <span>分辨率 {basisResolution(row)}</span>}
        {row.freeTier !== null && <span className="text-amber">免费额度:{row.freeTier}</span>}
        {row.contextWindow !== null && <span>上下文 {row.contextWindow}</span>}
        <span>截至 {row.dataAsOf}</span>
      </div>
      <ResolutionLadder row={row} />
    </div>
  );
}

/** 外部榜单名次角标(P5;meta 行内 chip) */
function LeaderboardBadges({
  badges,
}: {
  badges: LeaderboardBadge[] | undefined;
}): React.ReactElement | null {
  if (badges === undefined || badges.length === 0) return null;
  return (
    <>
      {badges.map((b) => (
        <a
          key={b.source}
          href={b.url ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          title={`${b.source} ${b.board}: 第 ${b.rank} 名`}
          className="whitespace-nowrap rounded-sm border border-line bg-panel-2 px-1.5 py-0.5 text-[10px] leading-none text-text-2 hover:border-line-hover hover:text-text-1"
        >
          {b.source === "artificial-analysis" ? "AA" : "HF"} #{b.rank}
          {b.delta !== null && (
            <span className={b.delta > 0 ? "text-green" : b.delta < 0 ? "text-red" : "text-text-3"}>
              {b.delta > 0 ? "↑" : b.delta < 0 ? "↓" : "—"}
            </span>
          )}
        </a>
      ))}
    </>
  );
}
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
  /** 协议多选(空 = 全部) */
  protocols: ApiProtocol[];
  onProtocolsChange: (v: ApiProtocol[]) => void;
  sort: ModelSortId;
  onSortChange: (v: ModelSortId) => void;
  /** 模型区视图:列表 | 比价(M74 批D) */
  view: PricingViewId;
  onViewChange: (v: PricingViewId) => void;
  /** 场景价(P4) */
  scenario: PricingScenarioId;
  onScenarioChange: (v: PricingScenarioId) => void;
  /** 关键词搜索(UX P1) */
  q: string;
  onQChange: (v: string) => void;
  /** 自定义价格区间(UX P2) */
  pmin: number | null;
  pmax: number | null;
  onPriceRangeChange: (min: number | null, max: number | null) => void;
  /** 参数筛选(UX P2) */
  tierParamFilter: TierParamFilter;
  onTierParamFilterChange: (v: TierParamFilter) => void;
  /** 外部榜单角标(P5) */
  leaderboardMap?: Map<string, LeaderboardBadge[]>;
  /** 模型对比选集(勾选列表行,与 Coding Plan 同构) */
  modelCompareKeys: string[];
  onToggleModelCompare: (key: string) => void;
  modelCompareLimit: number;
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
  protocols,
  onProtocolsChange,
  sort,
  onSortChange,
  view,
  onViewChange,
  scenario,
  onScenarioChange,
  q,
  onQChange,
  pmin,
  pmax,
  onPriceRangeChange,
  tierParamFilter,
  onTierParamFilterChange,
  leaderboardMap = new Map(),
  modelCompareKeys,
  onToggleModelCompare,
  modelCompareLimit,
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
          q,
          pmin,
          pmax,
          tierParams: tierParamFilter,
          protocols,
        }),
        sort,
      ),
    [
      sortedModels,
      selectedVendors,
      band,
      freeScope,
      cat,
      contextBand,
      sourceKind,
      q,
      pmin,
      pmax,
      tierParamFilter,
      protocols,
      sort,
    ],
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
        protocols: [],
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
  // 组展开规则(2026-11-26 反馈:筛选词元所后列表「没有数据」——实为所有组默认
  // 收起,筛选后只剩组头):默认 = 单版本组展开、多版本组收起;任一收窄筛选
  // 激活时全部展开(让命中行直接可见);手动展开/收起只记显式覆盖,筛选条件
  // 变化即失效(避免「先收起、再筛选」残留成空态错觉)
  const filterActive =
    selectedVendors.length > 0 ||
    q.trim() !== "" ||
    pmin !== null ||
    pmax !== null ||
    band !== "all" ||
    freeScope !== "all" ||
    protocols.length > 0 ||
    sourceKind !== "" ||
    contextBand !== "all" ||
    tierParamFilter.resolution !== undefined ||
    tierParamFilter.hasAudio !== undefined ||
    tierParamFilter.durationGte !== undefined;
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>({});
  const filterSig = JSON.stringify([
    selectedVendors,
    q,
    pmin,
    pmax,
    band,
    freeScope,
    protocols,
    sourceKind,
    contextBand,
    tierParamFilter,
  ]);
  useEffect(() => {
    setGroupOverrides({});
  }, [filterSig]);
  const isGroupExpanded = useCallback(
    (g: { key: string; rows: PublicModelRow[] }): boolean =>
      g.key in groupOverrides ? groupOverrides[g.key] : g.rows.length === 1 || filterActive,
    [groupOverrides, filterActive],
  );
  const regionGroups = useMemo(
    () => buildRegionGroups(allRows, visibleKeys, isGroupExpanded),
    [allRows, visibleKeys, isGroupExpanded],
  );
  const toggleGroup = (g: ModelGroupDef): void => {
    setGroupOverrides((prev) => ({ ...prev, [g.key]: !g.expanded }));
  };
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
      </div>
      {/* 场景价选择器(P4):与用途页签同处顶层,默认 off 保持现有表格不变 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel-2/30 px-4 py-2">
        <span className="mr-1 text-[11px] text-text-3">场景</span>
        {scenarioOptions().map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={scenario === s.id}
            onClick={() => onScenarioChange(s.id)}
            className={`rounded-full border px-2.5 py-1 text-[11.5px] leading-none transition-colors cursor-pointer select-none ${
              scenario === s.id
                ? "border-accent bg-accent text-white"
                : "border-line bg-panel text-text-2 hover:border-line-hover hover:text-text-1"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <ActiveFilterChips
        state={{
          vendors: selectedVendors,
          band,
          freeScope,
          cat,
          contextBand,
          sourceKind,
          q,
          protocols,
        }}
        onPatch={(patch) => {
          if (patch.vendors !== undefined) onVendorsChange(patch.vendors);
          if (patch.band !== undefined) onBandChange(patch.band);
          if (patch.freeScope !== undefined) onFreeScopeChange(patch.freeScope);
          if (patch.cat !== undefined) onCatChange(patch.cat);
          if (patch.contextBand !== undefined) onContextBandChange(patch.contextBand);
          if (patch.sourceKind !== undefined) onSourceKindChange(patch.sourceKind);
          if (patch.q !== undefined) onQChange(patch.q);
          if (patch.protocols !== undefined) onProtocolsChange(patch.protocols);
        }}
        onReset={() => {
          onVendorsChange([]);
          onBandChange("all");
          onFreeScopeChange("all");
          onCatChange("text");
          onContextBandChange("all");
          onSourceKindChange("");
          onQChange("");
          onProtocolsChange([]);
        }}
      />
      {/* lg+:左侧常驻筛选栏(2026-11-18 反馈问题一);<lg:顶部 FilterBar,同一份状态 */}
      <div className="lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
        <div className="hidden lg:block">
          <div className="border-b border-line px-4 py-3">
            <SearchBox value={q} onChange={onQChange} />
          </div>
          <div className="border-b border-line px-4 py-3">
            <div className="mb-1 text-[10.5px] text-text-3">自定义价格</div>
            <PriceRangeInput pmin={pmin} pmax={pmax} onApply={onPriceRangeChange} />
          </div>
          {(cat === "video" || cat === "image") && (
            <div className="border-b border-line px-4 py-3">
              <ParamFilterGroup
                cat={cat}
                rows={catRows}
                filter={tierParamFilter}
                onChange={onTierParamFilterChange}
              />
            </div>
          )}
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
            protocols={protocols}
            onProtocolsChange={onProtocolsChange}
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
          <div className="lg:hidden border-b border-line px-4 py-2.5">
            <SearchBox value={q} onChange={onQChange} />
          </div>
          {(cat === "video" || cat === "image") && (
            <div className="lg:hidden border-b border-line px-4 py-2.5">
              <ParamFilterGroup
                cat={cat}
                rows={catRows}
                filter={tierParamFilter}
                onChange={onTierParamFilterChange}
              />
            </div>
          )}
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
              protocols={protocols}
              onProtocolsChange={onProtocolsChange}
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
            <div className="border-t border-line px-4 py-10 text-center text-[13px] text-text-3">
              {modelCompareKeys.length === 0 ? (
                <p>请在「列表」中勾选至少 2 个模型，再进入比价视图。</p>
              ) : modelCompareKeys.length === 1 ? (
                <p>已选 1 个模型，还需再选 1 个才能对比。</p>
              ) : (
                <p>已选 {modelCompareKeys.length} 个模型，点击托盘「开始对比」或直接打开弹窗。</p>
              )}
            </div>
          ) : (
            regionGroups.map(({ key, modelGroups, visibleCount }) => (
              <div
                key={key}
                // 批D8:全量行必须进 DOM(SEO 红线),但视口外的分组可跳过布局绘制
                className="border-b border-line last:border-b-0 [content-visibility:auto] [contain-intrinsic-size:auto_600px]"
              >
                <div className="flex items-center gap-2 border-b border-line bg-panel-2/50 px-4 py-3">
                  <h2 className="text-[13px] font-semibold text-text-1">
                    {groupTitle(
                      key,
                      modelGroups.flatMap((g) => g.rows),
                    )}
                  </h2>
                  <span className="ml-auto font-mono text-[11px] text-blue">{visibleCount}</span>
                </div>
                <ModelTable
                  modelGroups={modelGroups}
                  visibleKeys={visibleKeys}
                  onToggleGroup={toggleGroup}
                  scenario={scenario}
                  leaderboardMap={leaderboardMap}
                  modelCompareKeys={modelCompareKeys}
                  onToggleModelCompare={onToggleModelCompare}
                  modelCompareLimit={modelCompareLimit}
                />
                <ModelCards
                  modelGroups={modelGroups}
                  visibleKeys={visibleKeys}
                  onToggleGroup={toggleGroup}
                  scenario={scenario}
                  leaderboardMap={leaderboardMap}
                  modelCompareKeys={modelCompareKeys}
                  onToggleModelCompare={onToggleModelCompare}
                  modelCompareLimit={modelCompareLimit}
                />
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

/** 型号组定义 */
interface ModelGroupDef {
  key: string;
  displayName: string;
  rows: PublicModelRow[];
  visibleCount: number;
  multi: boolean;
  /** 渲染期算好的展开态(默认规则 + 手动覆盖) */
  expanded: boolean;
}

/** 外层 region|currency 组定义(内层含型号组) */
interface RegionGroupDef {
  key: string;
  title: string;
  visibleCount: number;
  modelGroups: ModelGroupDef[];
}

/** 列表分组:外层 region|currency → 内层型号组(能力归一 key)
 *  统一组头可展开/收起;展开态由 isExpanded 决定(单版本默认展开、
 *  多版本默认收起、筛选激活时全展开,手动覆盖优先)。
 */
function buildRegionGroups(
  allRows: PublicModelRow[],
  visibleKeys: Set<string>,
  isExpanded: (g: { key: string; rows: PublicModelRow[] }) => boolean,
): RegionGroupDef[] {
  const regionKeys = [...new Set(allRows.map(groupKey))];
  return regionKeys
    .map((regionKey) => {
      const regionRows = allRows.filter((m) => groupKey(m) === regionKey);
      const groupMap = new Map<string, PublicModelRow[]>();
      for (const r of regionRows) {
        const gk = modelGroupKey(r);
        if (!groupMap.has(gk)) groupMap.set(gk, []);
        groupMap.get(gk)!.push(r);
      }
      const modelGroups: ModelGroupDef[] = [...groupMap.entries()]
        .map(([key, rows]) => ({
          key,
          displayName: modelGroupName(rows),
          rows,
          visibleCount: rows.filter((m) => visibleKeys.has(rowKey(m))).length,
          multi: rows.length > 1,
          expanded: isExpanded({ key, rows }),
        }))
        .filter((g) => g.visibleCount > 0);
      const visibleCount = modelGroups.reduce((sum, g) => sum + g.visibleCount, 0);
      return {
        key: regionKey,
        title: groupTitle(regionKey, regionRows),
        visibleCount,
        modelGroups,
      };
    })
    .filter((g) => g.visibleCount > 0);
}
