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

import type { ModelPrefillRow } from "../crawlers";

/** 混元定价文档(种子初始值;运行期 URL 归 crawl_source 后台可调) */
export const TENCENT_HUNYUAN_URL = "https://cloud.tencent.com/document/product/1729/97731";

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
