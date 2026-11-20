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
 * 免费口径(2026-11-18):`free` 取 all|full|quota|any;旧值 `free=1`(只认
 * 完全免费的老开关)按 `full` 承接,老链接不失效。
 */
import type { ContextBandId } from "./context";
import type { FreeScopeId, ModelCatId, ModelSortId, PriceBandId } from "./public";

/** 模型区视图:列表(逐行列价)| 比价(同模型跨提供商并排 + 散点/条形图) */
export type PricingViewId = "list" | "compare" | "charts";

/** 页内大页签(2026-11-18 反馈:按量模型与 Coding Plan 挤一页不利查看):
 * model=模型调用(按量)| plan=Coding Plan(订阅)。两块内容都 SSR 全量进
 * HTML(SEO 红线),非活动页签整块 `hidden` 藏住——与列表视图藏行的技巧同源 */
export type PricingPanelId = "model" | "plan";

/** 筛选态 */
export interface PricingQueryState {
  /** 厂商多选(空 = 全部) */
  vendors: string[];
  /** 价格区间档(按代表价:token 行输入价 / 非 token 行生成价) */
  band: PriceBandId;
  /** 免费口径(all / full 完全免费 / quota 有免费额度 / any 任一免费) */
  freeScope: FreeScopeId;
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
  /** 页内大页签(默认 model) */
  panel: PricingPanelId;
}

export const DEFAULT_PRICING_QUERY: PricingQueryState = {
  vendors: [],
  band: "all",
  freeScope: "all",
  cat: "text",
  contextBand: "all",
  sourceKind: "",
  sort: "default",
  view: "list",
  panel: "model",
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
const FREE_SCOPES: ReadonlySet<string> = new Set(["all", "full", "quota", "any"]);

/** 免费口径参数值 → 口径;旧值 `free=1`(只认完全免费的老开关)按 full 承接 */
function freeScopeOf(raw: string | null): FreeScopeId {
  if (raw === "1") return "full";
  return FREE_SCOPES.has(raw ?? "") ? (raw as FreeScopeId) : "all";
}

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
    freeScope: freeScopeOf(params.get("free")),
    panel: params.get("panel") === "plan" ? "plan" : "model",
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
  if (state.freeScope !== "all") params.set("free", state.freeScope);
  if (state.cat !== DEFAULT_PRICING_QUERY.cat) params.set("cat", state.cat);
  if (state.contextBand !== DEFAULT_PRICING_QUERY.contextBand) params.set("ctx", state.contextBand);
  if (state.sourceKind !== "") params.set("src", state.sourceKind);
  if (state.sort !== DEFAULT_PRICING_QUERY.sort) params.set("sort", state.sort);
  if (state.view !== DEFAULT_PRICING_QUERY.view) params.set("view", state.view);
  if (state.panel !== DEFAULT_PRICING_QUERY.panel) params.set("panel", state.panel);
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
    a.freeScope === b.freeScope &&
    a.cat === b.cat &&
    a.contextBand === b.contextBand &&
    a.sourceKind === b.sourceKind &&
    a.sort === b.sort &&
    a.view === b.view &&
    a.panel === b.panel &&
    a.vendors.length === b.vendors.length &&
    a.vendors.every((v, i) => v === b.vendors[i])
  );
}
