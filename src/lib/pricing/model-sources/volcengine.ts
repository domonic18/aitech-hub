/**
 * 火山引擎方舟(Volcengine Ark)按量模型牌价(M74 批B3):渲染通道取数 + DOM 解析。
 *
 * 实探结论(2026-11-15):`/docs/ark/model-pricing` 静态 HTML 里 0 处价格(表是
 * 客户端渲染),**必须走 card-renderer**(headless)取数。
 *
 * 渲染后的 DOM 结构:
 * - 章节标题是带 `data-leaf="true"` 的行内文本节点(「大语言模型」「在线推理（常规）」
 *   「在线推理（低延迟）」「在线推理（低优）」「批量推理」),按文档序夹在表格之间
 * - 每张表 = 表头行 + 数据行;表头行的单位写在格子里(「输入(非音频)元/M token」),
 *   **价格格只有数字**(如 6.00),没有「元」后缀
 * - 同一模型多行 = **输入长度阶梯**(如 doubao-seed-2.0-pro 分 [0,32] / (32,128] /
 *   (128,256] 三档),阶梯行的模型名格为空 → 继承上一行的模型
 * - 条件列还可能是**时段**(空闲时段 / 高峰时段)——峰谷定价是另一个维度
 *
 * 三个维度(场景 × 输入长度阶梯 × 时段)都落档位;行价取
 * **「在线推理（常规）」场景 + 最小输入长度档**(常态价:请求越短越便宜,
 * 第一档是绝大多数请求落点;与「时段优惠取最高」的保守基准不是一回事)。
 */
import * as cheerio from "cheerio";

import type { SnapshotSink } from "../../collect/snapshot-capture";
import { snapshotHtml } from "../render-fetch";
import type { ModelPrefillRow, ModelTierPrefill } from "../crawlers";

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
  if (h.includes("输入(非音频)") || h.includes("输入（非音频）")) return "input";
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
 * 条件格 → 档位标签 + token 边界。
 * 「输入长度 [0, 32]」→ 标签 "[0, 32]K",边界 0 – 32768
 * 「输入长度 (32, 128]」→ 标签 "(32, 128]K",边界 32768 – 131072
 * 「空闲时段」/「高峰时段」→ 时段标签,无 token 边界
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
    modelId: string;
    cond: string;
    input: number | null;
    output: number | null;
    cache: number | null;
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

      let currentModel = "";
      rows.slice(1).each((_, r) => {
        const cells = $(r)
          .children()
          .map((_, c) => $(c).text().trim())
          .get();
        if (cells.length === 0) return;
        const rec = {
          scene,
          modelId: "",
          cond: "",
          input: null as number | null,
          output: null as number | null,
          cache: null as number | null,
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
              rec.input = priceOf(text);
              break;
            case "output":
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

  if (records.length === 0) throw new Error("volcengine 价格表未匹配(页面可能改版)");

  // 按模型归一:一行一模型,场景 × 阶梯 × 时段 各落一档
  const byModel = new Map<string, typeof records>();
  for (const rec of records) {
    const list = byModel.get(rec.modelId);
    if (list === undefined) byModel.set(rec.modelId, [rec]);
    else list.push(rec);
  }

  const out: ModelPrefillRow[] = [];
  for (const [modelId, rows] of byModel) {
    const tiers: ModelTierPrefill[] = [];
    for (const rec of rows) {
      const cond = condOf(rec.cond);
      const label = rec.scene === "" ? cond.label : `${rec.scene}·${cond.label}`;
      const tier: ModelTierPrefill = {
        tierLabel: label,
        inputPrice: rec.input,
        outputPrice: rec.output,
        cachePrice: rec.cache,
        minTokens: cond.min,
        maxTokens: cond.max,
        unit: "per_1m_tokens",
      };
      const dup = tiers.find((t) => t.tierLabel === tier.tierLabel);
      if (dup !== undefined) {
        if (
          dup.inputPrice === tier.inputPrice &&
          dup.outputPrice === tier.outputPrice &&
          dup.cachePrice === tier.cachePrice
        ) {
          continue;
        }
        let n = 2;
        while (tiers.some((t) => t.tierLabel === `${label}·${n}`)) n += 1;
        tier.tierLabel = `${label}·${n}`;
      }
      tiers.push(tier);
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
      tiers,
    });
  }
  return out;
}
