/**
 * 硅基流动(SiliconFlow)按量模型牌价(M74 批B):静态取数 + DOM 解析。
 *
 * 实探结论(2026-11-15):`/pricing` 静态 fetch 即可拿到完整价格表(820KB HTML,
 * 价格直接落在 DOM 里,**不需要 headless**)。表格是 div 网格而非 <table>:
 * 行容器 class 含 `min-h-[48px]` + `grid`;行首格是模型(显示名 + `a[title]` 里的
 * 模型 id,如 `deepseek-ai/DeepSeek-V4.1-Flash`),其后是价格格。
 *
 * 价格格有两层维度:
 * - **时段**:格内「费用发生时段: 0点～2点/8点～24点」——同一模型有多个时段价
 *   (2点～8点 是优惠窗,比其余时段便宜)
 * - **列位**:每时段组内按 输入 / 输出 / 缓存 三列排布(缓存列可缺省)
 *
 * 口径:行价取各时段里的**最高**输入/输出价(保守基准,不把优惠窗当成常态价);
 * 完整时段结构与缓存价落档位表(缓存价在行上无处安放,必须进档位)。
 */
import * as cheerio from "cheerio";

import type { ModelPrefillRow, ModelTierPrefill } from "../crawlers";

/** 官方价格页(种子初始值;运行期 URL 归 crawl_source 后台可调) */
export const SILICONFLOW_PRICING_URL = "https://siliconflow.cn/pricing";

/** 价格格:时段标签(无=不限时段)+ 价格 */
interface PriceCell {
  label: string | null;
  price: number | null;
}

/** 行容器识别:牌价行的 class 特征(grid + min-h-[48px]);分类行无此 class */
function isPriceRow(cls: string): boolean {
  return cls.includes("min-h-[48px]") && cls.includes("grid");
}

/** 硅基流动价格页解析(纯函数,fixture 单测锚) */
export function parseSiliconflow(html: string, sourceUrl: string, now: Date): ModelPrefillRow[] {
  const $ = cheerio.load(html);
  const rows = $("div").filter((_, el) => isPriceRow(el.attribs.class ?? ""));
  const out: ModelPrefillRow[] = [];

  rows.each((_, el) => {
    const kids = $(el).children();
    if (kids.length < 3) return; // 分类行(厂商/分类名),无价格
    const link = kids.eq(0).find("a[title]").first();
    const modelId = (link.attr("title") ?? "").trim();
    if (modelId === "") return;

    // 价格格按「时段标签」分组;无标签的归默认组
    const groups = new Map<string, PriceCell[]>();
    const order: string[] = [];
    kids.slice(1).each((_, c) => {
      // 价格格 → 时段标签 + 价格(null = 无价,不臆测)
      let label: string | null = null;
      $(c)
        .find("span")
        .each((__, sp) => {
          if (label !== null) return;
          const t = $(sp).text().trim();
          if (t.startsWith("费用发生时段")) {
            label = t.replace(/^费用发生时段[:：]\s*/, "").trim();
          }
        });
      const priceText = $(c).find("span.tabular-nums").first().text().trim();
      const priceMatch = priceText.match(/[¥￥]\s*([\d.]+)/);
      const cell: PriceCell = {
        label,
        price: priceMatch === null ? null : Number(priceMatch[1]),
      };
      const key = cell.label ?? "";
      if (!groups.has(key)) {
        groups.set(key, []);
        order.push(key);
      }
      groups.get(key)!.push(cell);
    });

    // 组内按列位:0=输入 1=输出 2=缓存(缓存列可缺省)
    const tiers: ModelTierPrefill[] = [];
    const tierLabels: string[] = [];
    for (const key of order) {
      const cells = groups.get(key)!;
      if (cells.length > 3) {
        throw new Error(`siliconflow 价格列数异常(${cells.length}>3,页面可能改版)`);
      }
      const tier: ModelTierPrefill = {
        tierLabel: key === "" ? "默认" : key,
        inputPrice: cells[0]?.price ?? null,
        outputPrice: cells[1]?.price ?? null,
        cachePrice: cells[2]?.price ?? null,
        minTokens: null,
        maxTokens: null,
        unit: "per_1m_tokens",
      };
      tiers.push(tier);
      tierLabels.push(tier.tierLabel);
    }

    // 行价 = 各时段里的最高价(保守基准:不把优惠窗当常态价)
    const inputs = tiers.map((t) => t.inputPrice).filter((v): v is number => v !== null);
    const outputs = tiers.map((t) => t.outputPrice).filter((v): v is number => v !== null);
    if (inputs.length === 0 && outputs.length === 0) return; // 无价不臆测

    out.push({
      vendor: "硅基流动 SiliconFlow",
      modelKey: modelId,
      currency: "CNY",
      inputPrice: inputs.length === 0 ? null : Math.max(...inputs),
      outputPrice: outputs.length === 0 ? null : Math.max(...outputs),
      contextWindow: null,
      note: `[官方页爬虫 ${now.toISOString().slice(0, 10)}] ${modelId};时段价:${tierLabels.join(" / ")}`,
      dataAsOf: now,
      sourceUrl,
      region: "cn",
      providerKey: "siliconflow",
      tiers,
    });
  });

  if (out.length === 0) throw new Error("siliconflow 价格行结构未匹配(页面可能改版)");
  return out;
}
