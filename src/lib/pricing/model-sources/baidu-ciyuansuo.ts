/**
 * 百度词元所(cysuo.com)聚合报价采集(M74 批B4,2026-11-18 定稿):
 * 渲染通道三段式 —— /providers 目录(供应方全集)→ 逐供应方页(模型全集枚举)
 * → 逐模型详情页(元信息 + 每供应方报价表)。
 *
 * **合规口径(站长裁定 2026-11-18,不走官方授权、自采)**:robots.txt
 * `Allow: /` + `Disallow: /kog/` —— 全量数据虽在 /kog JSON API,但只采
 * robots 允许的页面 URL(本模块全部页面在 /providers 与 /model-market 下),
 * 数据由页面自身前端取回渲染,采集器不直接请求被禁路径。与火山引擎同为
 * 渲染型源(RENDER_ALLOWED_HOSTS 需含 cysuo.com,compose 与本表两处同步)。
 *
 * 为什么不采 /model-market 列表页:它对 40 个模型做虚拟列表,单次滚底渲染
 * 仅挂载 ~36 张卡(枚举不完整);而「供应方页 → 模型名」是确定性的全集枚举
 * (每个模型必有 ≥1 个供应方资源)。列表页的单位卡(/M /s)也不需要——单位
 * 由详情页模态 chip 推导(实测 40/40:text→元/百万,video→元/秒)。
 *
 * 渲染后 DOM 实探(2026-11-18,fixture 锚):
 * - 目录页:/providers 下 25 个 `a[href^="/providers/<id>?region=<r>"]`
 * - 供应方页:「资源信息」表 = 模型名(纯文本,无链接)+ 地区;模型名即详情 slug
 * - 模型详情页:头部紧凑文本 `模型详情<slug><文本|视频|音频|图片>…原厂:<名>
 *   [上下文:<值>]上线:<日期>地区:<城市>…供应商数<N>家`;「供应资源」表
 *   每行 = 供应方(链接 /providers/<id> + 徽标 云服务|原厂)+ 地区 + 价格
 *   (输入:¥X/百万 Token 输出:¥Y/百万 Token 省N%;「-」=不适用)+ 资源状态;
 *   **表格按价升序分页(10/页),原厂直供行无折扣排在末页** —— 分页不翻页
 *   恰好丢一手价,故必须按 `&page=N` 翻到不满页为止(URL 参数实测有效)
 * - 单位陷阱:详情表价格格恒印「/百万 Token」,**视频模型实为元/秒**(列表卡
 *   与 API 均为 /s)—— 单位一律取模态推导,不信表格列文案
 */
import * as cheerio from "cheerio";

import { logWarn } from "@/lib/logger";

import type { SnapshotSink } from "../../collect/snapshot-capture";
import { snapshotHtml } from "../render-fetch";
import type { ModelPrefillRow } from "../crawlers";
import { unitForModality } from "../collect/units";

/** 渠道注册 URL(model-market 落地页):行级 sourceUrl 锚 + 墓碑/待复核按源匹配口径 */
export const CYSUO_MARKET_URL = "https://cysuo.com/model-market";

/** 枚举入口(robots 允许路径;供应方目录) */
const CYSUO_PROVIDERS_PATH = "/providers";

/** 详情表分页大小(渲染实测 10/页;满页即续翻) */
const DETAIL_PAGE_SIZE = 10;

/** 单模型详情最多翻页数(兜底,防解析异常导致死翻) */
const MAX_DETAIL_PAGES = 5;

/** 供应方页同样 10/页分页(实测可灵 12 模型,第 2 页藏着 2 个);满页续翻上限 */
const MAX_PROVIDER_PAGES = 3;

/** 渲染礼貌间隔(页与页之间;采集周期日级,爬虫礼仪) */
const RENDER_GAP_MS = 1200;

/** 供应方徽标 → 转述语义(原厂=厂商自营一手挂牌;云服务=第三方转售) */
type CiyuansuoKind = "official" | "cloud";

function kindOfBadge(text: string): CiyuansuoKind | null {
  if (text.includes("原厂")) return "official";
  if (text.includes("云服务")) return "cloud";
  return null;
}

// ---------- 三段式解析(纯函数,fixture 单测锚)----------

export interface CiyuansuoProviderRef {
  providerId: string;
  region: string;
}

/** 目录页 → 供应方全集(`/providers/<id>?region=<r>` 链接) */
export function parseCiyuansuoProviderDir(html: string): CiyuansuoProviderRef[] {
  const $ = cheerio.load(html);
  const out = new Map<string, CiyuansuoProviderRef>();
  $('a[href^="/providers/"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const rest = href.slice("/providers/".length);
    const [id, query] = rest.split("?");
    if (!/^\d+$/.test(id)) return; // 目录自身/杂链不收
    const region = new URLSearchParams(query ?? "").get("region") ?? "";
    if (region === "") return;
    if (!out.has(id)) out.set(id, { providerId: id, region });
  });
  return [...out.values()];
}

export interface CiyuansuoModelRef {
  modelKey: string;
  region: string;
}

/** 表头位 → 单元格位:复选框列只有 td 没有 th(渲染实测),按差值探测偏移 */
function cellOffsetOf(headers: string[], cells: unknown[]): number {
  const diff = cells.length - headers.length;
  return diff === 1 ? 1 : 0;
}

/** 供应方页「资源信息」表 → 该供应方的模型×地区(模型全集枚举的来源) */
export function parseCiyuansuoProvider(html: string): CiyuansuoModelRef[] {
  const $ = cheerio.load(html);
  const out = new Map<string, CiyuansuoModelRef>();
  $("table").each((_, table) => {
    const headers = $(table)
      .find("thead th")
      .map((_, c) => $(c).text().trim())
      .get();
    const modelCol = headers.findIndex((h) => h === "模型");
    const regionCol = headers.findIndex((h) => h === "地区");
    if (modelCol === -1 || regionCol === -1) return;
    $(table)
      .find("tbody tr")
      .each((_, tr) => {
        const cells = $(tr)
          .find("td")
          .map((_, c) => $(c).text().trim())
          .get();
        if (cells.length < headers.length) return;
        const off = cellOffsetOf(headers, cells);
        // 模型名格 = 纯文本 slug;复选框列在前,按表头位对齐取格
        const name = cells[modelCol + off] ?? "";
        const region = cells[regionCol + off] ?? "";
        if (!/^[A-Za-z0-9._-]{1,60}$/.test(name) || region === "") return;
        if (!out.has(name)) out.set(name, { modelKey: name, region });
      });
  });
  return [...out.values()];
}

export interface CiyuansuoQuote {
  supplier: string;
  kind: CiyuansuoKind;
  inputPrice: number | null;
  outputPrice: number | null;
  /** 折扣百分比(省 N% 的 N;无则 null) */
  discountPercent: number | null;
  status: string;
}

export interface CiyuansuoModelMeta {
  modelKey: string;
  /** 页面模态 chip:文本|视频|音频|图片 */
  modality: string;
  originalVendor: string;
  contextWindow: string | null;
  supplierCount: number | null;
}

export interface CiyuansuoDetail {
  meta: CiyuansuoModelMeta;
  quotes: CiyuansuoQuote[];
}

/** 价格格数字:「¥0.74」→ 0.74;「-」/空 → null(不适用,不是 0)。冒号兼容全角/半角 */
function cellPrice(text: string, label: string): number | null {
  const m = new RegExp(`${label}[：:]\\s*[¥￥]?([\\d.]+|-|—)`).exec(text);
  if (m === null) return null;
  const v = m[1] ?? "";
  return /^[\d.]+$/.test(v) ? Number(v) : null;
}

/** 模型详情页 → 元信息 + 供应方报价表(单页) */
export function parseCiyuansuoModelDetail(html: string): CiyuansuoDetail {
  const $ = cheerio.load(html);
  const compact = $("body")
    .text()
    .replace(/[ \t\n]+/g, "");

  // 头部:模型详情<slug><模态>…原厂:<名>[上下文:<值>]上线:…供应商数<N>家
  const head = /模型详情([A-Za-z0-9._-]{1,60}?)(文本|视频|音频|图片)/.exec(compact);
  const vendor = /原厂[:：](.{1,30}?)(?:上下文[:：]|上线[:：])/.exec(compact)?.[1] ?? "";
  const context = /上下文[:：]([0-9A-Za-zKMTkm]{1,10}?)上线[:：]/.exec(compact)?.[1] ?? null;
  const supplierCount = /供应商数(\d+)家/.exec(compact);
  const meta: CiyuansuoModelMeta = {
    modelKey: head?.[1] ?? "",
    modality: head?.[2] ?? "",
    originalVendor: vendor.trim(),
    contextWindow: context,
    supplierCount: supplierCount === null ? null : Number(supplierCount[1]),
  };
  if (meta.modelKey === "" || meta.modality === "" || meta.originalVendor === "") {
    throw new Error("词元所详情头部未匹配(页面可能改版)");
  }

  const quotes: CiyuansuoQuote[] = [];
  $("table").each((_, table) => {
    const headers = $(table)
      .find("thead th")
      .map((_, c) => $(c).text().trim())
      .get();
    const supplierCol = headers.findIndex((h) => h.includes("供应商"));
    const priceCol = headers.findIndex((h) => h.includes("价格"));
    const statusCol = headers.findIndex((h) => h.includes("资源状态"));
    if (supplierCol === -1 || priceCol === -1 || statusCol === -1) return;
    $(table)
      .find("tbody tr")
      .each((_, tr) => {
        const cells = $(tr)
          .find("td")
          .map((_, c) => $(c))
          .get();
        if (cells.length < headers.length) return;
        const off = cellOffsetOf(headers, cells);
        const supplierCell = cells[supplierCol + off];
        const priceCell = cells[priceCol + off];
        const statusCell = cells[statusCol + off];
        if (supplierCell === undefined || priceCell === undefined) return;
        const supplier = supplierCell.find('a[href^="/providers/"]').text().trim();
        if (supplier === "") return;
        const kind = kindOfBadge(supplierCell.text());
        if (kind === null) return; // 徽标认不出:不落(口径不明宁可少收)
        const priceText = priceCell.text();
        const discount = /省(\d+)%/.exec(priceText);
        quotes.push({
          supplier,
          kind,
          inputPrice: cellPrice(priceText, "输入"),
          outputPrice: cellPrice(priceText, "输出"),
          discountPercent: discount === null ? null : Number(discount[1]),
          status: (statusCell?.text() ?? "").trim(),
        });
      });
  });
  if (quotes.length === 0) throw new Error("词元所供应资源表未匹配(页面可能改版)");
  return { meta, quotes };
}

/** 模态 → 行级计价单位(collect 单一出处);认不出的模态 → null(整模型跳过,单位闸) */
export function ciyuansuoUnitForModality(modality: string): string | null {
  return unitForModality(modality);
}

/**
 * 供应方页「地区」列(中文)→ 站点 URL 用的 region slug(英文;站点自身链接
 * 均为英文值)。**北京区模型不带 region 参数渲染 0 行**(实测 MiniMax-H3),
 * 故 slug 认不出时跳过该模型留痕,不构造裸 URL 猜默认区。
 */
const CYSUO_REGION_SLUGS: Record<string, string> = { 广州: "guangzhou", 北京: "beijing" };

export function ciyuansuoRegionSlug(chinese: string): string | null {
  return CYSUO_REGION_SLUGS[chinese] ?? null;
}

/** 详情 URL(行级溯源落 note;渠道 sourceUrl 统一挂注册 URL 保墓碑口径) */
export function ciyuansuoDetailUrl(origin: string, modelKey: string, regionSlug: string): string {
  return `${origin}/model-market/${modelKey}?region=${regionSlug}`;
}

/** 单模型详情(含翻页)→ 落库行;单位不明的模态整模型跳过(返回空,调用方留痕) */
export function buildCiyuansuoRows(
  model: CiyuansuoModelRef,
  detail: CiyuansuoDetail,
  origin: string,
  channelUrl: string,
  now: Date,
): ModelPrefillRow[] {
  const unit = ciyuansuoUnitForModality(detail.meta.modality);
  if (unit === null) return [];
  const regionSlug = ciyuansuoRegionSlug(model.region);
  if (regionSlug === null) return [];
  const day = now.toISOString().slice(0, 10);
  const detailUrl = ciyuansuoDetailUrl(origin, model.modelKey, regionSlug);
  const total = detail.meta.supplierCount ?? detail.quotes.length;
  const rows: ModelPrefillRow[] = [];
  for (const q of detail.quotes) {
    if (!q.status.includes("服务中")) continue; // 非服务中资源不收(下线/维护价不可买)
    const kindLabel = q.kind === "official" ? "原厂直供" : "云服务转售";
    rows.push({
      vendor: `词元所·${q.supplier}`,
      modelKey: model.modelKey,
      currency: "CNY",
      // 视频(按秒)行:单价格落生成价(outputPrice),输入价不适用置 null
      inputPrice: unit === "per_1m_tokens" ? q.inputPrice : null,
      outputPrice: q.outputPrice,
      contextWindow: detail.meta.contextWindow,
      note: `[词元所 ${day}] ${kindLabel}${q.discountPercent === null ? "" : ` · 省${q.discountPercent}%`} · 共${total}家 · ${detailUrl}`.slice(
        0,
        200,
      ),
      dataAsOf: now,
      sourceUrl: channelUrl,
      region: "cn",
      providerKey: "baidu-ciyuansuo",
      modality: detail.meta.modality === "文本" ? "text" : "video",
      priceUnit: unit,
    });
  }
  return rows;
}

// ---------- 取数编排(渲染三段式;页间礼貌间隔)----------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 单模型详情逐页收取(满页续翻,不满页止;原厂直供行恰在末页,不可少翻) */
async function collectDetailPages(
  origin: string,
  model: CiyuansuoModelRef,
  sink: SnapshotSink | undefined,
): Promise<CiyuansuoDetail> {
  const regionSlug = ciyuansuoRegionSlug(model.region);
  if (regionSlug === null) throw new Error(`词元所地区未映射:${model.region}`);
  const base = ciyuansuoDetailUrl(origin, model.modelKey, regionSlug);
  const quotes: CiyuansuoQuote[] = [];
  let meta: CiyuansuoModelMeta | null = null;
  for (let page = 1; page <= MAX_DETAIL_PAGES; page += 1) {
    const url = page === 1 ? base : `${base}&page=${page}`;
    const shot = await snapshotHtml(url);
    await sink?.({
      tab: `m-${model.modelKey}-p${page}`,
      html: shot.html,
      httpStatus: shot.httpStatus,
    });
    const parsed = parseCiyuansuoModelDetail(shot.html);
    if (meta === null) meta = parsed.meta;
    quotes.push(...parsed.quotes);
    if (parsed.quotes.length < DETAIL_PAGE_SIZE) break; // 不满页 = 末页
  }
  if (meta === null) throw new Error("词元所详情零页解析");
  return { meta, quotes };
}

/**
 * 词元所全量取数:目录 → 25 供应方页(枚举模型全集)→ 逐模型详情(含翻页)。
 * 约 70 次渲染/日(1 + 25 + ~45 详情页),页间 1.2s,日级周期内属礼貌范围。
 * 失败容忍:单个供应方页/模型详情页失败跳过留痕(其余源覆盖大部分模型);
 * 一行都没解析出来才判源失败(编排层记健康度连败)。
 */
export async function fetchCiyuansuo(
  channelUrl: string,
  sink?: SnapshotSink,
  now: Date = new Date(),
  opts: { gapMs?: number } = {},
): Promise<ModelPrefillRow[]> {
  const gapMs = opts.gapMs ?? RENDER_GAP_MS;
  const origin = new URL(channelUrl).origin;

  const dirShot = await snapshotHtml(`${origin}${CYSUO_PROVIDERS_PATH}`);
  await sink?.({ tab: "dir", html: dirShot.html, httpStatus: dirShot.httpStatus });
  const providers = parseCiyuansuoProviderDir(dirShot.html);
  if (providers.length === 0) throw new Error("词元所供应方目录未匹配(页面可能改版)");

  const models = new Map<string, CiyuansuoModelRef>();
  for (const p of providers) {
    try {
      for (let page = 1; page <= MAX_PROVIDER_PAGES; page += 1) {
        const url =
          page === 1
            ? `${origin}${CYSUO_PROVIDERS_PATH}/${p.providerId}?region=${p.region}`
            : `${origin}${CYSUO_PROVIDERS_PATH}/${p.providerId}?region=${p.region}&page=${page}`;
        const shot = await snapshotHtml(url);
        await sink?.({
          tab: `p-${p.providerId}-p${page}`,
          html: shot.html,
          httpStatus: shot.httpStatus,
        });
        const found = parseCiyuansuoProvider(shot.html);
        for (const m of found) {
          if (!models.has(m.modelKey)) models.set(m.modelKey, m);
        }
        if (found.length < DETAIL_PAGE_SIZE) break; // 不满页 = 末页
      }
    } catch (e) {
      logWarn("pricing.ciyuansuo_provider_failed", {
        providerId: p.providerId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    await sleep(gapMs);
  }
  if (models.size === 0) throw new Error("词元所模型枚举为空(供应方页全失败?)");

  const rows: ModelPrefillRow[] = [];
  let skippedUnit = 0;
  for (const model of models.values()) {
    try {
      const detail = await collectDetailPages(origin, model, sink);
      const built = buildCiyuansuoRows(model, detail, origin, channelUrl, now);
      if (built.length === 0) skippedUnit += 1;
      rows.push(...built);
    } catch (e) {
      logWarn("pricing.ciyuansuo_model_failed", {
        modelKey: model.modelKey,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    await sleep(gapMs);
  }
  if (skippedUnit > 0) {
    logWarn("pricing.ciyuansuo_unit_skipped", { count: skippedUnit });
  }
  if (rows.length === 0) throw new Error("词元所全量解析失败(模型详情页全失败)");
  return rows;
}
