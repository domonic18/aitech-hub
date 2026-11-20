/**
 * 腾讯云混元(Hunyuan)按量模型牌价(M74 批B):静态取数 + DOM 解析。
 *
 * 实探结论(2026-11-15):`cloud.tencent.com/document/product/1729/97731` 静态
 * fetch 即可拿到两张结构干净的表(**不需要 headless**):
 * - 「产品名 | 免费额度」——免费额度原文(如「共100万 tokens,共享消耗」)
 * - 「产品名 | 刊例价(每 百万 tokens)」——形如「输入:0.5元输出:2元」
 *
 * 口径:按**表头**识别表(不靠表序号,页面插表会错位);只认「每 百万 tokens」
 * 的刊例价表;缺价不臆测(留 null);免费额度原文入 free_tier(不是「完全免费」,
 * 两者语义分开)。
 */
import * as cheerio from "cheerio";

import type { SnapshotSink } from "../../collect/snapshot-capture";
import { logInfo } from "../../logger";
import { formatContextTokens, normalizeModelKey, parseContextTokens } from "../context";
import type { ModelPrefillRow } from "../crawlers";

/** 混元定价文档(种子初始值;运行期 URL 归 crawl_source 后台可调) */
export const TENCENT_HUNYUAN_URL = "https://cloud.tencent.com/document/product/1729/97731";

/**
 * 混元「产品概述」文档(伴生页·上下文出处):刊例价表只有价,逐模型的
 * **最大输入**在这一页的模型表里(如 hunyuan-a13b「最大输入224k 最大输出32k」)。
 * 静态 SSR,普通 fetch 即可。
 */
export const TENCENT_HUNYUAN_OVERVIEW_URL =
  "https://cloud.tencent.com/document/product/1729/104753";

/** 表头 → 表类型 */
type TencentTableKind = "price" | "free";

function tableKindOf(header: string): TencentTableKind | null {
  if (header.includes("刊例价") || header.includes("每 百万 tokens")) return "price";
  if (header.includes("免费额度")) return "free";
  return null;
}

/** 「输入:0.5元输出:2元」→ 输入价 / 输出价(缺项留 null) */
function parsePriceCell(text: string): { input: number | null; output: number | null } {
  const input = /输入[:：]\s*([\d.]+)\s*元/.exec(text);
  const output = /输出[:：]\s*([\d.]+)\s*元/.exec(text);
  return {
    input: input === null ? null : Number(input[1]),
    output: output === null ? null : Number(output[1]),
  };
}

/**
 * 伴生页(产品概述)取数+解析(失败返回空表并记日志,不连坐主源):
 * 刊例价表不带上下文档位,上下文只在这一页;它挂了不该让价一起丢。
 */
export async function fetchTencentContextMap(sink?: SnapshotSink): Promise<Map<string, string>> {
  try {
    const res = await fetch(TENCENT_HUNYUAN_OVERVIEW_URL, { cache: "no-store" });
    const html = await res.text();
    await sink?.({ tab: "overview", html, httpStatus: res.status });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return parseTencentModelContexts(html);
  } catch (e) {
    logInfo("pricing.source.context_fetch_failed", {
      source: "tencent-hunyuan",
      error: e instanceof Error ? e.message : String(e),
    });
    return new Map();
  }
}

/**
 * 混元「产品概述」页 → 归一模型名 → 最大输入(上下文口径)。
 * 取「模型名称(API 调用名)」列与「输入输出」列;模型名带别名时取括号前的主名。
 */
export function parseTencentModelContexts(html: string): Map<string, string> {
  const $ = cheerio.load(html);
  const map = new Map<string, string>();
  $("tr").each((_, r) => {
    const cells = $(r)
      .find("td,th")
      .map((_, c) =>
        $(c)
          .text()
          .replace(/\u200b/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .get();
    if (cells.length < 5) return;
    const name = (cells[1] ?? "").split("（")[0]?.trim() ?? "";
    if (name === "") return;
    const m = /最大输入\s*([\d.]+)\s*([kKmM])/.exec(cells[4] ?? "");
    if (m === null) return;
    const key = normalizeModelKey(name);
    if (key === "") return;
    map.set(key, `${m[1]}${(m[2] ?? "").toUpperCase()}`);
  });
  return map;
}

/**
 * 牌价行模型名 → 上下文。行名与文档名形态不一(「Hunyuan-a13b」vs
 * 「hunyuan-a13b」、「Hunyuan-t1-vision」vs「hunyuan-t1-vision-20250916」),
 * 归一后精确匹配;匹配不上再按「文档名以行名开头」前缀兜底。
 */
export function matchTencentContext(modelKey: string, map: Map<string, string>): string | null {
  const key = normalizeModelKey(modelKey);
  if (key === "") return null;
  const exact = map.get(key);
  if (exact !== undefined) return exact;
  for (const [docKey, context] of map) {
    if (docKey.startsWith(`${key}-`)) return context;
  }
  return null;
}

/** 给牌价行补上下文窗口(混元是 token 计价模型,全表都补) */
export function applyTencentContexts(
  rows: ModelPrefillRow[],
  map: Map<string, string>,
): ModelPrefillRow[] {
  return rows.map((r) => {
    const context = matchTencentContext(r.modelKey, map);
    if (context === null) return r;
    const tokens = parseContextTokens(context);
    if (tokens === null) return r;
    return { ...r, contextWindow: formatContextTokens(tokens) };
  });
}

/** 腾讯云混元定价页解析(纯函数,fixture 单测锚) */
export function parseTencentHunyuan(html: string, sourceUrl: string, now: Date): ModelPrefillRow[] {
  const $ = cheerio.load(html);
  const prices = new Map<string, { input: number | null; output: number | null }>();
  const freeTiers = new Map<string, string>();

  $("table").each((_, t) => {
    const trs = $(t).find("tr");
    const kind = tableKindOf(trs.first().text());
    if (kind === null) return;
    trs.slice(1).each((_, r) => {
      const cells = $(r)
        .children()
        .toArray()
        .map((c) => $(c).text().trim().replace(/\s+/g, " "));
      const name = cells[0] ?? "";
      if (name === "") return;
      if (kind === "price") {
        const value = cells[1] ?? "";
        prices.set(name, parsePriceCell(value));
      } else {
        const value = (cells[1] ?? "").trim();
        if (value !== "") freeTiers.set(name, value);
      }
    });
  });

  const out: ModelPrefillRow[] = [];
  for (const [modelKey, price] of prices) {
    if (price.input === null && price.output === null) continue; // 无价不臆测
    out.push({
      vendor: "腾讯云",
      modelKey,
      currency: "CNY",
      inputPrice: price.input,
      outputPrice: price.output,
      contextWindow: null,
      note: `[官方页爬虫 ${now.toISOString().slice(0, 10)}] 混元刊例价(每百万 tokens)`,
      dataAsOf: now,
      sourceUrl,
      region: "cn",
      providerKey: "tencent-cloud",
      freeTier: freeTiers.get(modelKey) ?? null,
      tiers: [
        {
          tierLabel: "默认",
          inputPrice: price.input,
          outputPrice: price.output,
          cachePrice: null,
          minTokens: null,
          maxTokens: null,
          unit: "per_1m_tokens",
        },
      ],
    });
  }

  if (out.length === 0) throw new Error("tencent 混元价格表未匹配(页面可能改版)");
  return out;
}
