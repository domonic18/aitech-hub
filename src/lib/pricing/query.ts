/**
 * /pricing/ 筛选态 ⇄ URL 查询参数编解码(M74 批C;批G 模态细筛升级为用途分组)。
 *
 * 为什么:比价页的筛选是「用户结论」的一部分(「只看免费」「≥1M 上下文」「官方一手价」),
 * 必须可分享/可收藏/可后退。页本身保持 ISR 静态——URL 只驱动**客户端**筛选,
 * 不让筛选态把页面拖成动态渲染(SEO 生命线)。
 *
 * 参数名短而稳(v/b/free/cat/ctx/src/sort):URL 要能被人读与手改。
 * 批G:cat 默认 **text**(用途页签默认落在「文本」组;cat=all 才显式编码);
 * 旧 mod 参数(批C 模态细筛)读到后按值映射到 cat 再丢弃——上线一天,
 * 外链稀少,不做双写。
 */
import type { ContextBandId, ModelCatId, ModelSortId, PriceBandId } from "./public";

/** 模型区视图:列表(逐行列价)| 比价(同模型跨提供商并排 + 散点/条形图) */
export type PricingViewId = "list" | "compare" | "charts";

/** 筛选态 */
export interface PricingQueryState {
  /** 厂商多选(空 = 全部) */
  vendors: string[];
  /** 价格区间档(按代表价:token 行输入价 / 非 token 行生成价) */
  band: PriceBandId;
  /** 只看完全免费 */
  freeOnly: boolean;
  /** 用途分组(批G;默认 text) */
  cat: ModelCatId;
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
  cat: "text",
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
const VIEWS: ReadonlySet<string> = new Set(["list", "compare", "charts"]);
const CATS: ReadonlySet<string> = new Set(["text", "image", "video", "audio", "vector", "all"]);

/** 旧 mod 参数(模态值)→ 用途分组;认不出回落默认 */
function catOfLegacyMod(mod: string): ModelCatId {
  if (mod === "image" || mod === "video" || mod === "audio") return mod;
  if (mod === "embedding" || mod === "rerank") return "vector";
  return "text"; // text / text+vision / 未知 → 文本组
}

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
  const cat = params.get("cat") ?? "";
  const legacyMod = params.get("mod") ?? "";
  return {
    vendors: [...new Set(vendors)],
    band: (BANDS.has(band) ? band : "all") as PriceBandId,
    freeOnly: params.get("free") === "1",
    cat: (CATS.has(cat)
      ? cat
      : legacyMod !== ""
        ? catOfLegacyMod(legacyMod)
        : "text") as ModelCatId,
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
  if (state.cat !== DEFAULT_PRICING_QUERY.cat) params.set("cat", state.cat);
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
    a.cat === b.cat &&
    a.contextBand === b.contextBand &&
    a.sourceKind === b.sourceKind &&
    a.sort === b.sort &&
    a.view === b.view &&
    a.vendors.length === b.vendors.length &&
    a.vendors.every((v, i) => v === b.vendors[i])
  );
}
