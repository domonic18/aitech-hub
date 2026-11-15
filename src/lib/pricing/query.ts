/**
 * /pricing/ 筛选态 ⇄ URL 查询参数编解码(M74 批C;纯函数,零库依赖零 env)。
 *
 * 为什么:比价页的筛选是「用户结论」的一部分(「只看免费」「≥1M 上下文」「官方一手价」),
 * 必须可分享/可收藏/可后退。页本身保持 ISR 静态——URL 只驱动**客户端**筛选,
 * 不让筛选态把页面拖成动态渲染(SEO 生命线)。
 *
 * 参数名短而稳(v/b/free/mod/ctx/src/sort):URL 要能被人读与手改。
 */
import type { ContextBandId, ModelSortId, PriceBandId } from "./public";

/** 模型区视图:列表(逐行列价)| 比价(同模型跨提供商并排 + 散点) */
export type PricingViewId = "list" | "compare";

/** 筛选态 */
export interface PricingQueryState {
  /** 厂商多选(空 = 全部) */
  vendors: string[];
  /** 价格区间档 */
  band: PriceBandId;
  /** 只看完全免费 */
  freeOnly: boolean;
  /** 模态(空 = 全部) */
  modality: string;
  /** 上下文长度档 */
  contextBand: ContextBandId;
  /** 来源类型(空 = 全部) */
  sourceKind: string;
  /** 排序 */
  sort: ModelSortId;
  /** 模型区视图 */
  view: PricingViewId;
}

export const DEFAULT_PRICING_QUERY: PricingQueryState = {
  vendors: [],
  band: "all",
  freeOnly: false,
  modality: "",
  contextBand: "all",
  sourceKind: "",
  sort: "default",
  view: "list",
};

const BANDS: ReadonlySet<string> = new Set(["all", "lt10", "10-50", "50-100", "100-300", "gte300"]);
const CONTEXT_BANDS: ReadonlySet<string> = new Set([
  "all",
  "ge1m",
  "ge256k",
  "ge128k",
  "lt128k",
  "unknown",
]);
const SORTS: ReadonlySet<string> = new Set(["default", "input", "output", "name"]);
const VIEWS: ReadonlySet<string> = new Set(["list", "compare"]);

/** 查询串 → 筛选态(非法值一律回落默认,不抛错——URL 是用户可手改的) */
export function decodePricingQuery(input: URLSearchParams | string): PricingQueryState {
  const params = typeof input === "string" ? new URLSearchParams(input) : input;
  const vendors = (params.get("v") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "");
  const band = params.get("b") ?? "";
  const contextBand = params.get("ctx") ?? "";
  const sort = params.get("sort") ?? "";
  const view = params.get("view") ?? "";
  return {
    vendors: [...new Set(vendors)],
    band: (BANDS.has(band) ? band : "all") as PriceBandId,
    freeOnly: params.get("free") === "1",
    modality: params.get("mod") ?? "",
    contextBand: (CONTEXT_BANDS.has(contextBand) ? contextBand : "all") as ContextBandId,
    sourceKind: params.get("src") ?? "",
    sort: (SORTS.has(sort) ? sort : "default") as ModelSortId,
    view: (VIEWS.has(view) ? view : "list") as PricingViewId,
  };
}

/** 筛选态 → 查询串(全默认时返回空串——URL 保持干净) */
export function encodePricingQuery(state: PricingQueryState): string {
  const params = new URLSearchParams();
  if (state.vendors.length > 0) params.set("v", state.vendors.join(","));
  if (state.band !== DEFAULT_PRICING_QUERY.band) params.set("b", state.band);
  if (state.freeOnly) params.set("free", "1");
  if (state.modality !== "") params.set("mod", state.modality);
  if (state.contextBand !== DEFAULT_PRICING_QUERY.contextBand) params.set("ctx", state.contextBand);
  if (state.sourceKind !== "") params.set("src", state.sourceKind);
  if (state.sort !== DEFAULT_PRICING_QUERY.sort) params.set("sort", state.sort);
  if (state.view !== DEFAULT_PRICING_QUERY.view) params.set("view", state.view);
  return params.toString();
}

/** 筛选态是否等于默认(用于「重置筛选」判定) */
export function isDefaultPricingQuery(state: PricingQueryState): boolean {
  return encodePricingQuery(state) === "";
}

/** 两个筛选态是否等价(用于 URL 回填时避免无谓重渲染) */
export function samePricingQuery(a: PricingQueryState, b: PricingQueryState): boolean {
  return (
    a.band === b.band &&
    a.freeOnly === b.freeOnly &&
    a.modality === b.modality &&
    a.contextBand === b.contextBand &&
    a.sourceKind === b.sourceKind &&
    a.sort === b.sort &&
    a.view === b.view &&
    a.vendors.length === b.vendors.length &&
    a.vendors.every((v, i) => v === b.vendors[i])
  );
}
