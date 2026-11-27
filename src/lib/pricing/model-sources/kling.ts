/**
 * 快手可灵(Kling)视频牌价(M81,2026-11-27 实探):文档站渲染取数 + DOM 解析。
 *
 * 取数通道:`/document-api/pricing/base/video` 是 SPA(静态 fetch 只有 76KB 空壳,
 * 0 处价格),必须走渲染通道;`/dev/pricing` 的「更多定价」按钮就是跳这一页。
 *
 * 收哪些行:模型行(模型名以 Kling 开头)且价格格是「N积分/秒」;HDR 加价行
 * (「+ 0.3积分/秒」)与按次/按 5 秒计费的功能行(数字人、对口型、音频生成…)
 * 不收——它们不是模型价。
 *
 * 行价口径:基准能力(含「无输入视频」/「无声」优先,否则首个能力)
 * × 最低分辨率档 = 入口价;其余能力/分辨率档全部落档位表(前台可展开)。
 * 积分单价等共用件见 kling-shared.ts。
 */
import * as cheerio from "cheerio";

import { pushPrefillTier, type ModelPrefillRow, type ModelTierPrefill } from "../crawlers";
import { normalizeModelKey } from "../normalize";
import {
  creditsPerSecond,
  pickEntry,
  PROVIDER_KEY,
  resolutionOfHeader,
  tableGrid,
  toCny,
  VENDOR,
} from "./kling-shared";

/** 视频表 → 牌价行 */
export function parseKlingVideoPricing(
  html: string,
  sourceUrl: string,
  now: Date,
  creditCny: number,
): ModelPrefillRow[] {
  const $ = cheerio.load(html);
  const day = now.toISOString().slice(0, 10);
  /** 模型名 → 该模型的档位 */
  const byModel = new Map<string, ModelTierPrefill[]>();
  /** 模型名 → 各档原始信息(能力/分辨率/积分) */
  const meta = new Map<
    string,
    Array<{ label: string; capability: string; resolution: string; credits: number }>
  >();

  $("table").each((_, table) => {
    const grid = tableGrid($, table);
    if (grid.length < 2) return;
    const header = grid[0]!.map((c) => c.text);
    if (!header.some((h) => h.includes("模型"))) return;
    if (!header.some((h) => h.includes("计费方式"))) return;
    const priceCols: Array<{ idx: number; resolution: string }> = [];
    header.forEach((h, i) => {
      const res = resolutionOfHeader(h);
      if (res !== null) priceCols.push({ idx: i, resolution: res });
    });
    if (priceCols.length === 0) return;

    for (const row of grid.slice(1)) {
      const model = (row[0]?.text ?? "").trim();
      // 只收模型行:功能行(数字人/对口型/音频生成/图像识别…)不是模型价
      if (!/^Kling\b/i.test(model)) continue;
      const func = (row[1]?.text ?? "").trim();
      if (func === "") continue;
      const tiers = byModel.get(model) ?? [];
      const list = meta.get(model) ?? [];
      for (const { idx, resolution } of priceCols) {
        const credits = creditsPerSecond(row[idx]?.text ?? "");
        if (credits === null) continue; // 「-」/「+ 0.3积分/秒」等加价与缺价:不臆测
        const label = `${func}·${resolution}`;
        pushPrefillTier(tiers, {
          tierLabel: label,
          inputPrice: null,
          outputPrice: toCny(credits, creditCny),
          cachePrice: null,
          minTokens: null,
          maxTokens: null,
          unit: "per_second",
        });
        list.push({ label, capability: func, resolution, credits });
      }
      byModel.set(model, tiers);
      meta.set(model, list);
    }
  });

  const out: ModelPrefillRow[] = [];
  for (const [model, tiers] of byModel) {
    if (tiers.length === 0) continue;
    const list = meta.get(model)!;
    // 基准能力:无输入视频(=文生视频)/无声(=默认无音轨)优先,否则该模型首个能力;
    // 动作控制是功能不是模型档,不参与基准
    const caps = [...new Set(list.map((m) => m.capability))];
    const baseCap =
      caps.find((c) => /无输入视频|无声/.test(c) && !c.includes("动作控制")) ?? caps[0]!;
    const pool = list.filter((m) => m.capability === baseCap);
    const entry = pickEntry(pool);
    if (entry === null) continue;
    out.push({
      vendor: VENDOR,
      modelKey: normalizeModelKey(model),
      currency: "CNY",
      inputPrice: null,
      outputPrice: toCny(entry.credits, creditCny),
      contextWindow: null,
      note: `[官方页爬虫 ${day}] ${model} · ${entry.label}(${entry.credits} 积分/秒,1 积分 = ${creditCny} 元)`,
      dataAsOf: now,
      sourceUrl,
      region: "cn",
      providerKey: PROVIDER_KEY,
      priceUnit: "per_second",
      modality: "video",
      tiers,
    });
  }
  if (out.length === 0) throw new Error("kling 视频价格表未匹配(页面可能改版)");
  return out;
}
