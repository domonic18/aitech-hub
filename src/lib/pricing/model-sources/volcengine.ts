/**
 * 火山引擎方舟(Volcengine Ark)按量模型牌价(M74 批B3):渲染通道取数 + DOM 解析。
 *
 * 实探(2026-11-15):`/docs/ark/model-pricing` 静态 HTML 里 0 处价格(表是客户端
 * 渲染),**必须走 card-renderer**(headless)取数。
 *
 * 渲染后 DOM:章节标题是 `data-leaf="true"` 的行内文本节点(「在线推理（常规）」等),
 * 夹在表格之间;每张表 = 表头行 + 数据行,单位写在表头格内(「元/M token」「元/张」),
 * 价格格只有数字。同一模型多行 = 输入长度阶梯(阶梯行模型格为空 → 继承上一行);
 * 条件列还可能是时段(空闲/高峰)——峰谷定价是另一个维度。
 *
 * 三个维度(场景 × 输入长度阶梯 × 时段)都落档位;行价取**「在线推理（常规）」+ 最小
 * 输入长度档**(常态价:请求越短越便宜,第一档是绝大多数请求落点)。
 *
 * 批G 单位闸:单位表级识别——token 表双价;按张/按秒表收单价格(生成价落 outputPrice、
 * 行级 priceUnit);**认不出单位的表整表跳过**(单位不明的价混进 token 比价就是污染)。
 *
 * M77 图片表(按张计价):价格格按**输出总像素 P** 与生图场景分档(实探 2026-11-20,
 * 如 seedream-5-5「P ≤ 2.61M：0.13」),格内各段以零宽字符 U+200B 分隔 → 走
 * ark-image-price.parsePriceEntries 拆档;行价取标准场景的最低像素档,档位名带分辨率/
 * 场景标签(不套 token 表的推理场景前缀,那是错标)。
 *
 * M80 视频表(按片计价 + 官方折合价):表头「模型 | 价格口径 | 480p | 720p | 1080p | 4K」,
 * 每个模型两行——「视频单价（元/个）」(按片价,随视频时长变动)与「折合价格（元/秒）」
 * (官方自己给的每秒口径)。**行价取折合价**:它与百炼/百度的按秒价同口径,可直接比价、
 * 可算场景成本;按片价只作档位附注(不进行价——同型号不同时长价不同,一个数说不清)。
 * 另有一张「视频价格范围（元/个）」表(如 480p 3.63～14.12),那是同一每秒价按时长展开
 * 的区间(3.63/0.672 ≈ 5.4s、14.12/0.672 = 21s),不另立口径,不采。
 */
import * as cheerio from "cheerio";

import type { SnapshotSink } from "../../collect/snapshot-capture";
import { snapshotHtml } from "../render-fetch";
import { pushPrefillTier, type ModelPrefillRow, type ModelTierPrefill } from "../crawlers";
import { unitOfTableLike } from "../collect/units";
import { normalizeModelKey } from "../normalize";
import { resolutionRank } from "../resolution";

import { parsePriceEntries, pickBaseEntry } from "./ark-image-price";

/** 官方牌价文档(种子初始值;运行期 URL 归 crawl_source 后台可调) */
export const VOLCENGINE_ARK_PRICING_URL = "https://www.volcengine.com/docs/ark/model-pricing";

/** 章节标题(推理场景)→ 档位标签前缀 */
const SCENE_TITLES = [
  "大语言模型",
  "在线推理（常规）",
  "在线推理（低延迟）",
  "在线推理（低优）",
  "批量推理",
] as const;

/** 行价基准场景(最主流的在线推理常规) */
const BASE_SCENE = "在线推理（常规）";

/** 列语义槽位 */
type ColRole = "model" | "cond" | "input" | "output" | "cache" | null;

/** 表头 → 列语义(单位在格子里,故只认关键词) */
function colRoleOf(header: string): ColRole {
  const h = header.replace(/\s+/g, "").replace(/\u200b/g, "");
  if (h.includes("模型名称")) return "model";
  if (h.includes("条件")) return "cond";
  if (h.includes("缓存命中(非音频)") || h.includes("缓存命中（非音频）")) return "cache";
  // 图片表列头是「输入图单价（元/张）」「输出图单价（元/张）」(M77 实探),
  // 与 token 表的「输入(非音频)」不是同一条,两种都要认
  if (h.includes("输入图单价") || h.includes("输入(非音频)") || h.includes("输入（非音频）"))
    return "input";
  if (h.includes("输出")) return "output";
  return null;
}

/** 「6.00」→ 6.00;「-」/空 → null(不适用,不是 0) */
function priceOf(text: string): number | null {
  const t = text.replace(/\u200b/g, "").trim();
  if (t === "" || t === "-" || t === "暂不支持") return null;
  const m = /^([\d.]+)$/.exec(t);
  return m === null ? null : Number(m[1]);
}

/**
 * 条件格 → 档位标签 + token 边界:「输入长度 [0, 32]」→ 标签 "[0, 32]K"、边界
 * 0 – 32768;「(32, 128]」→ "(32, 128]K"、32768 – 131072;时段/分辨率等其余情形
 * → 原文标签,无 token 边界。
 */
function condOf(text: string): { label: string; min: number | null; max: number | null } {
  const t = text.trim();
  const m = /输入长度\s*([\[(])(\d+)\s*,\s*(\d+)\s*(\])/.exec(t);
  if (m !== null) {
    const lo = Number(m[2]) * 1024;
    const hi = Number(m[3]) * 1024;
    return { label: `${m[1]}${m[2]}, ${m[3]}${m[4]}K`, min: lo, max: hi };
  }
  if (t === "" || t === "-") return { label: "默认", min: null, max: null };
  return { label: t, min: null, max: null };
}

/** 表级单位识别(collect 单位闸):表头格识别,认不出 → null 整表跳过 */
function unitOfTable(headers: string[]): string | null {
  return unitOfTableLike(headers, []);
}

/** token 系单位(双价语义);其余为单价格(生成价)语义 */
function isTokenUnit(unit: string): boolean {
  return unit === "per_1m_tokens" || unit === "per_1k_tokens";
}

/** 视频价口径表:每模型的折合价(元/秒)与按片价(元/个),按分辨率 */
interface ArkVideoPrice {
  /** 分辨率 → 折合价(元/秒) */
  perSecond: Map<string, number>;
  /** 分辨率 → 按片价(元/个) */
  perItem: Map<string, number>;
}

/**
 * 「价格口径」表 → 模型名 → 折合价/按片价(2026-11-27 实探)。
 * 表头「模型 | 价格口径 | 480p | 720p | 1080p | 4K」,每个模型两组数据行:
 * 「视频单价（元/个）」与「折合价格（元/秒）」;模型格为空即继承上一行。
 * 页面上同一张表渲染两遍(一份只有表头)——空表自然不产行,不用去重。
 */
function parseVideoPriceTables($: cheerio.CheerioAPI): Map<string, ArkVideoPrice> {
  const out = new Map<string, ArkVideoPrice>();
  $("table").each((_, el) => {
    const rows = $(el).find("tr");
    if (rows.length < 2) return;
    const headers = $(rows[0])
      .children()
      .map((_, c) => $(c).text().trim())
      .get();
    const modelIdx = headers.findIndex((h) => h.replace(/[​\s]/g, "") === "模型");
    const kindIdx = headers.findIndex((h) => h.includes("价格口径"));
    if (modelIdx < 0 || kindIdx < 0) return;
    const resolutions: Array<{ idx: number; res: string }> = [];
    headers.forEach((h, i) => {
      if (i <= kindIdx) return;
      const res = h.replace(/[​\s]/g, "");
      if (/^\d+[pP]$/.test(res) || /^\d+[kK]$/.test(res)) resolutions.push({ idx: i, res });
    });
    if (resolutions.length === 0) return;
    let current = "";
    rows.slice(1).each((_, r) => {
      const cells = $(r)
        .children()
        .map((_, c) => $(c).text().trim())
        .get();
      if (cells.length === 0) return;
      const name = (cells[modelIdx] ?? "").replace(/​/g, "").trim();
      if (name !== "") current = name;
      if (current === "") return;
      const kind = (cells[kindIdx] ?? "").replace(/[​\s]/g, "");
      const isPerSecond = kind.includes("折合") && kind.includes("元/秒");
      const isPerItem = kind.includes("视频单价") && kind.includes("元/个");
      if (!isPerSecond && !isPerItem) return;
      const rec = out.get(current) ?? { perSecond: new Map(), perItem: new Map() };
      for (const { idx, res } of resolutions) {
        const price = priceOf(cells[idx] ?? "");
        if (price === null) continue; // 「不支持」/空 → 该分辨率无价,不臆测
        if (isPerSecond) rec.perSecond.set(res, price);
        else rec.perItem.set(res, price);
      }
      out.set(current, rec);
    });
  });
  return out;
}

/**
 * 视频口径表 → 牌价行:行价取**最低分辨率的折合价**(入口价口径,同 M77 图片行),
 * 各分辨率折合价落档位(前台分辨率阶梯直接可读);按片价只进 note(随时长变动,
 * 不进行价)。模态显式标 video——产品名「Seedance 2.5」按关键词也能推断,但源
 * 自己说是视频,显式标注优先。
 */
function videoPrefillRows(
  videos: Map<string, ArkVideoPrice>,
  sourceUrl: string,
  now: Date,
): ModelPrefillRow[] {
  const out: ModelPrefillRow[] = [];
  for (const [name, rec] of videos) {
    if (rec.perSecond.size === 0) continue;
    const sorted = [...rec.perSecond.entries()].sort(
      (a, b) =>
        (resolutionRank(a[0]) ?? Number.MAX_SAFE_INTEGER) -
        (resolutionRank(b[0]) ?? Number.MAX_SAFE_INTEGER),
    );
    const [baseRes, basePrice] = sorted[0]!;
    const tiers: ModelTierPrefill[] = [];
    for (const [res, price] of sorted) {
      pushPrefillTier(tiers, {
        tierLabel: res,
        inputPrice: null,
        outputPrice: price,
        cachePrice: null,
        minTokens: null,
        maxTokens: null,
        unit: "per_second",
      });
    }
    const item = rec.perItem.get(baseRes);
    out.push({
      vendor: "火山引擎方舟",
      modelKey: normalizeModelKey(name),
      currency: "CNY",
      inputPrice: null,
      outputPrice: basePrice,
      contextWindow: null,
      note: `[官方页爬虫 ${now.toISOString().slice(0, 10)}] ${name} · ${baseRes} 折合 ${basePrice} 元/秒${item === undefined ? "" : `(按片 ${item} 元/个)`}`,
      dataAsOf: now,
      sourceUrl,
      region: "cn",
      providerKey: "volcengine-ark",
      priceUnit: "per_second",
      modality: "video",
      tiers,
    });
  }
  return out;
}

/**
 * 取数走 card-renderer 渲染通道:该页静态 fetch 只有导航壳,价格表是客户端
 * 渲染的(实探:静态 1.8MB HTML 里 0 处价格)。失败先落快照再抛(改版当天的
 * 原文恰恰是唯一证据)。
 */
export async function fetchVolcengineArk(url: string, sink?: SnapshotSink): Promise<string> {
  const page = await snapshotHtml(url, undefined, { screenshot: sink !== undefined });
  await sink?.({ tab: "page", ...page });
  return page.html;
}

/** 火山引擎方舟牌价页解析(纯函数,fixture 单测锚) */
export function parseVolcengineArk(html: string, sourceUrl: string, now: Date): ModelPrefillRow[] {
  const $ = cheerio.load(html);
  const records: Array<{
    scene: string;
    unit: string;
    modelId: string;
    cond: string;
    input: number | null;
    output: number | null;
    cache: number | null;
    /** 原始价格格文本(非 token 表按像素/场景分档,要从原文拆) */
    inputText: string;
    outputText: string;
  }> = [];

  let scene = "";
  $("body")
    .find("*")
    .each((_, el) => {
      const leaf = el.attribs?.["data-leaf"];
      if (leaf === "true") {
        const t = $(el).text().trim();
        if ((SCENE_TITLES as readonly string[]).includes(t)) scene = t;
        return;
      }
      if (el.tagName !== "table") return;
      const rows = $(el).find("tr");
      if (rows.length < 2) return;
      const headers = $(rows[0])
        .children()
        .map((_, c) => $(c).text().trim())
        .get();
      const roles = headers.map(colRoleOf);
      if (!roles.includes("model") || !roles.includes("output")) return;
      const unit = unitOfTable(headers);
      if (unit === null) return; // 单位不明:整表跳过(宁可少收不可错收)

      let currentModel = "";
      rows.slice(1).each((_, r) => {
        const cells = $(r)
          .children()
          .map((_, c) => $(c).text().trim())
          .get();
        if (cells.length === 0) return;
        const rec = {
          scene,
          unit,
          modelId: "",
          cond: "",
          input: null as number | null,
          output: null as number | null,
          cache: null as number | null,
          inputText: "",
          outputText: "",
        };
        cells.forEach((text, i) => {
          switch (roles[i]) {
            case "model": {
              // 阶梯续行的模型格为空 → 继承上一行;格内带零宽字符需剥掉
              const name = text.replace(/\u200b/g, "").trim();
              if (name !== "" && name !== "模型名称") currentModel = name;
              rec.modelId = currentModel;
              break;
            }
            case "cond":
              rec.cond = text.replace(/\u200b/g, "").trim();
              break;
            case "input":
              rec.inputText = text;
              rec.input = priceOf(text);
              break;
            case "output":
              rec.outputText = text;
              rec.output = priceOf(text);
              break;
            case "cache":
              rec.cache = priceOf(text);
              break;
            default:
              break;
          }
        });
        if (rec.modelId === "" || rec.modelId === "模型名称") return;
        records.push(rec);
      });
    });

  const videos = parseVideoPriceTables($);
  if (records.length === 0 && videos.size === 0)
    throw new Error("volcengine 价格表未匹配(页面可能改版)");

  // 按模型归一:一行一模型,场景 × 阶梯 × 时段 各落一档;
  // 同一模型若跨单位表出现(罕见),保 token 系记录,不混单位落档
  const byModel = new Map<string, typeof records>();
  for (const rec of records) {
    const list = byModel.get(rec.modelId);
    if (list === undefined) byModel.set(rec.modelId, [rec]);
    else list.push(rec);
  }

  const out: ModelPrefillRow[] = [];
  for (const [modelId, allRows] of byModel) {
    const units = new Set(allRows.map((r) => r.unit));
    let rows = allRows;
    if (units.size > 1) {
      const keep = units.has("per_1m_tokens")
        ? "per_1m_tokens"
        : units.has("per_1k_tokens")
          ? "per_1k_tokens"
          : allRows[0]!.unit;
      rows = allRows.filter((r) => r.unit === keep);
    }
    const unit = rows[0]!.unit;

    const tiers: ModelTierPrefill[] = [];
    /** 非 token 行的生成价档(场景分组 + 档名 + 价):行价基准取自它 */
    const pricedEntries: Array<{ group: string | null; label: string; price: number }> = [];
    if (isTokenUnit(unit)) {
      for (const rec of rows) {
        const cond = condOf(rec.cond);
        const label = rec.scene === "" ? cond.label : `${rec.scene}·${cond.label}`;
        pushPrefillTier(tiers, {
          tierLabel: label,
          inputPrice: rec.input,
          outputPrice: rec.output,
          cachePrice: rec.cache,
          minTokens: cond.min,
          maxTokens: cond.max,
          unit,
        });
      }
    } else {
      // 非 token 表(按张/按秒):价格按档落,档名 = 条件列(分辨率) × 价格格内
      // 像素/场景档。档位名不带推理场景前缀——「在线推理(常规)/批量推理」是
      // token 表的推理场景,套到图片表上是错标(实探:曾被标成「批量推理·默认」)。
      for (const rec of rows) {
        const condLabel = rec.cond === "" ? null : rec.cond;
        const entries = parsePriceEntries(rec.outputText);
        if (entries.length === 0) {
          // 整格纯价但拆不出档(带单位后缀等)→ 用 priceOf 的结果兜底一档
          if (rec.output !== null) {
            pushPrefillTier(tiers, {
              tierLabel: condLabel ?? "默认",
              inputPrice: null,
              outputPrice: rec.output,
              cachePrice: null,
              minTokens: null,
              maxTokens: null,
              unit,
            });
          }
          continue;
        }
        for (const e of entries) {
          const parts = [condLabel, e.group, e.label].filter(
            (v): v is string => v !== null && v !== "",
          );
          pushPrefillTier(tiers, {
            tierLabel: parts.length === 0 ? "默认" : parts.join("·"),
            inputPrice: null,
            outputPrice: e.price,
            cachePrice: null,
            minTokens: null,
            maxTokens: null,
            unit,
          });
          pricedEntries.push({ group: e.group, label: parts.join("·"), price: e.price });
        }
      }
    }

    // 行价 = 基准场景(在线推理常规)+ 最小输入长度档;无基准场景则取最小 minTokens 的档
    const baseScene = rows.filter((r) => r.scene === BASE_SCENE);
    const pool = baseScene.length > 0 ? baseScene : rows;
    const withRange = pool.filter((r) => condOf(r.cond).min !== null);
    const base = (withRange.length > 0 ? withRange : pool).reduce((a, b) => {
      const am = condOf(a.cond).min;
      const bm = condOf(b.cond).min;
      if (am === null) return b;
      if (bm === null) return a;
      return bm < am ? b : a;
    });

    if (isTokenUnit(unit)) {
      out.push({
        vendor: "火山引擎方舟",
        modelKey: modelId,
        currency: "CNY",
        inputPrice: base.input,
        outputPrice: base.output,
        contextWindow: null,
        note: `[官方页爬虫 ${now.toISOString().slice(0, 10)}] ${modelId} · ${base.scene === "" ? "常规" : base.scene}`,
        dataAsOf: now,
        sourceUrl,
        region: "cn",
        providerKey: "volcengine-ark",
        priceUnit: unit,
        tiers,
      });
      continue;
    }

    // 按张/按秒行:行价取**基准档**——有场景分组时取首个分组(标准用法)的
    // 最低档,无分组时取全局最低档(低分辨率=入口价);各档完整落档位表。
    const inputEntries = rows.flatMap((r) => parsePriceEntries(r.inputText));
    const baseIn = pickBaseEntry(inputEntries);
    const firstGroup = pricedEntries.find((e) => e.group !== null)?.group ?? null;
    const pricePool =
      firstGroup === null ? pricedEntries : pricedEntries.filter((e) => e.group === firstGroup);
    const baseOut =
      pricePool.length > 0 ? pricePool.reduce((a, b) => (b.price < a.price ? b : a)) : null;
    if (baseOut === null) continue; // 无价不臆测(跳过该模型,不是中止整批)
    const basis = baseOut.label;
    out.push({
      vendor: "火山引擎方舟",
      modelKey: modelId,
      currency: "CNY",
      inputPrice: baseIn?.price ?? null,
      outputPrice: baseOut.price,
      contextWindow: null,
      note: `[官方页爬虫 ${now.toISOString().slice(0, 10)}] ${modelId}${basis === "默认" ? " · 单价计价" : ` · ${basis}`}`,
      dataAsOf: now,
      sourceUrl,
      region: "cn",
      providerKey: "volcengine-ark",
      priceUnit: unit,
      tiers,
    });
  }
  out.push(...videoPrefillRows(videos, sourceUrl, now));
  return out;
}
