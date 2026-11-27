/**
 * 快手可灵(Kling)图片牌价(M81,2026-11-27 实探):文档站渲染取数 + DOM 解析。
 *
 * 收哪些行:模型行(Kling Image 开头)且输出价是「N积分/张」;扩图/补全主体图等
 * 「通用」功能行不是模型价,不收。
 *
 * 行价口径:基准能力(文生图优先,否则该模型首个能力)× 最低分辨率档 = 入口价;
 * 其余能力/分辨率档全部落档位表(前台可展开)。参考图价按张落 inputPrice。
 * 积分单价与表格读取等共用件见 kling-shared.ts。
 */
import * as cheerio from "cheerio";

import { pushPrefillTier, type ModelPrefillRow, type ModelTierPrefill } from "../crawlers";
import { normalizeModelKey } from "../normalize";
import { creditsPerImage, pickEntry, PROVIDER_KEY, tableGrid, toCny, VENDOR } from "./kling-shared";

/** 图片表 → 牌价行 */
export function parseKlingImagePricing(
  html: string,
  sourceUrl: string,
  now: Date,
  creditCny: number,
): ModelPrefillRow[] {
  const $ = cheerio.load(html);
  const day = now.toISOString().slice(0, 10);
  const byModel = new Map<string, ModelTierPrefill[]>();
  const meta = new Map<
    string,
    Array<{
      label: string;
      capability: string;
      resolution: string;
      credits: number;
      inputCredits: number | null;
    }>
  >();

  $("table").each((_, table) => {
    const grid = tableGrid($, table);
    if (grid.length < 2) return;
    const header = grid[0]!.map((c) => c.text);
    if (!header.some((h) => h.includes("输出价格"))) return;
    const priceIdx = header.findIndex((h) => h.includes("输出价格"));
    const resIdx = header.findIndex((h) => h.includes("分辨率"));
    const inputIdx = header.findIndex((h) => h.includes("输入参考图"));
    const funcIdx = header.findIndex((h) => h.includes("功能"));
    // 输出规格-长度(短/中/长):同分辨率不同长度价不同,须进档位名否则同名相撞
    const lenIdx = header.findIndex((h) => h.includes("长度"));
    if (priceIdx < 0 || resIdx < 0) return;

    for (const row of grid.slice(1)) {
      const model = (row[0]?.text ?? "").trim();
      // 只收图片模型行:「通用」功能行(扩图/补全主体图)不是模型价
      if (!/^Kling\s+Image\b/i.test(model)) continue;
      const func = (row[funcIdx]?.text ?? "").trim();
      const resolution = (row[resIdx]?.text ?? "").trim();
      if (func === "" || resolution === "") continue;
      const credits = creditsPerImage(row[priceIdx]?.text ?? "");
      if (credits === null) continue;
      const inputCredits =
        inputIdx >= 0 ? creditsPerImage((row[inputIdx]?.text ?? "").split(/\s/)[0] ?? "") : null;
      const len = lenIdx >= 0 ? (row[lenIdx]?.text ?? "").trim() : "";
      const label = [func, len === "" || len === "-" ? null : len, resolution]
        .filter((v): v is string => v !== null && v !== "")
        .join("·");
      const tiers = byModel.get(model) ?? [];
      pushPrefillTier(tiers, {
        tierLabel: label,
        inputPrice: null,
        outputPrice: toCny(credits, creditCny),
        cachePrice: null,
        minTokens: null,
        maxTokens: null,
        unit: "per_image",
      });
      byModel.set(model, tiers);
      const list = meta.get(model) ?? [];
      list.push({ label, capability: func, resolution, credits, inputCredits });
      meta.set(model, list);
    }
  });

  const out: ModelPrefillRow[] = [];
  for (const [model, tiers] of byModel) {
    if (tiers.length === 0) continue;
    const list = meta.get(model)!;
    // 基准能力:文生图优先(本站比价主场景),否则该模型首个能力
    const caps = [...new Set(list.map((m) => m.capability))];
    const baseCap = caps.find((c) => c.includes("文生图")) ?? caps[0]!;
    const pool = list.filter((m) => m.capability === baseCap);
    const entry = pickEntry(pool);
    if (entry === null) continue;
    out.push({
      vendor: VENDOR,
      modelKey: normalizeModelKey(model),
      currency: "CNY",
      // 输入参考图/参考主体价(按张)——Kling Image 4.0 起参考图也计费
      inputPrice: entry.inputCredits === null ? null : toCny(entry.inputCredits, creditCny),
      outputPrice: toCny(entry.credits, creditCny),
      contextWindow: null,
      note: `[官方页爬虫 ${day}] ${model} · ${entry.label}(${entry.credits} 积分/张,1 积分 = ${creditCny} 元)`,
      dataAsOf: now,
      sourceUrl,
      region: "cn",
      providerKey: PROVIDER_KEY,
      priceUnit: "per_image",
      modality: "image",
      tiers,
    });
  }
  if (out.length === 0) throw new Error("kling 图片价格表未匹配(页面可能改版)");
  return out;
}
