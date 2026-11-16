/**
 * 硅基流动(SiliconFlow)按量模型牌价(M74 批B):静态取数 + DOM 解析。
 *
 * 实探结论(2026-11-15;批G 2026-11-17 复勘):`/pricing` 静态 fetch 即可拿到
 * 完整价格表(SSR,价格直接落在 DOM 里,不需要 headless)。表格是 div 网格:
 * 价格行 class 含 `min-h-[48px]` + `grid`,行首格是模型(`a[title]` 里的模型 id)。
 *
 * 价格格有两类形态:
 * - **文本模型行**(`id="pricing-row-text-…"`):格内「费用发生时段」标签分组,
 *   组内按 输入/输出/缓存 列位(token 双价)。口径:行价取各时段**最高**价
 *   (保守基准);完整时段结构与缓存价落档位表。
 * - **单价格行**(`id="pricing-row-image|audio|video-…"`,批G):计费项 + 单位标签
 *   (每图片/每秒)+ 一个价(¥ X 或「免费」)。生成价落 outputPrice、行级
 *   priceUnit、行 id 分区名作显式模态;单位标签认不出的行(如「每千字符」)
 *   整行跳过——单位不明的价不落库(宁可少收不可错收)。
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

/** 单价格行的单位标签 → 档位单位(认不出的不收) */
const SINGLE_UNIT_LABELS: ReadonlyArray<{ re: RegExp; unit: string }> = [
  { re: /每\s*图\s*片|每\s*张|元\s*\/\s*张/, unit: "per_image" },
  { re: /每\s*秒|元\s*\/\s*秒/, unit: "per_second" },
  { re: /每\s*分\s*钟|元\s*\/\s*分钟/, unit: "per_minute" },
];

/**
 * 输入长度阶梯标签 → token 边界：「输入 [0, 128k)」→ 0–131072、
 * 标签「[0, 128k)」；「[128k, +∞)」上界为 null；非阶梯标签返回 null
 */
function ladderBoundsOf(label: string): { label: string; min: number; max: number | null } | null {
  const t = label.replace(/\u00a0/g, " ").trim();
  const m = /^\u8f93\u5165\s*\[\s*([\d.]+)\s*([kKmM])?\s*,\s*(\+∞|[\d.]+)\s*([kKmM])?\s*\)$/.exec(
    t,
  );
  if (m === null) return null;
  const mult = (u: string | undefined): number =>
    u === undefined ? 1 : u.toLowerCase() === "k" ? 1024 : 1024 * 1024;
  const min = Math.round(Number(m[1]) * mult(m[2]));
  const max = m[3] === "+∞" ? null : Math.round(Number(m[3]) * mult(m[4]));
  return { label: t.replace(/^\u8f93\u5165\s*/, ""), min, max };
}

/** 行 id 分区名 → 显式模态(text 不标,留给关键词推断认 embedding/-vl 等) */
const ROW_KIND_MODALITY: Record<string, string> = {
  image: "image",
  audio: "audio",
  video: "video",
};

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
    if (kids.length < 2) return; // 空行;分类行(无模型链接)由下面的 modelId 闸拦
    const link = kids.eq(0).find("a[title]").first();
    const modelId = (link.attr("title") ?? "").trim();
    if (modelId === "") return;

    // ---- 批G:单价格行(图片/音频/视频分区)----
    const rowId = (el.attribs.id ?? "").trim();
    const idKind = /^pricing-row-(text|image|audio|video)-/.exec(rowId)?.[1];
    if (idKind !== "text") {
      const restText = kids
        .slice(1)
        .text()
        .replace(/\u00a0/g, " ");
      const unitLabel = SINGLE_UNIT_LABELS.find(({ re }) => re.test(restText));
      // 无行 id 的行也按单位标签嗅探(改版兜底):认不出单价格单位 → 走文本行路径
      if (unitLabel !== undefined) {
        const priceMatch = /[¥￥]\s*([\d.]+)/.exec(restText);
        const free = !priceMatch && /免费/.test(restText);
        const price = priceMatch !== null ? Number(priceMatch[1]) : free ? 0 : null;
        if (price === null) return; // 无价不臆测
        const unitLabelText = /每[^\s,，;；]{1,4}/.exec(restText)?.[0] ?? unitLabel.unit;
        out.push({
          vendor: "硅基流动 SiliconFlow",
          modelKey: modelId,
          currency: "CNY",
          inputPrice: null,
          outputPrice: price,
          contextWindow: null,
          note: `[官方页爬虫 ${now.toISOString().slice(0, 10)}] ${modelId} · 单价计价(${unitLabelText})`,
          dataAsOf: now,
          sourceUrl,
          region: "cn",
          providerKey: "siliconflow",
          modality: idKind === undefined ? undefined : ROW_KIND_MODALITY[idKind],
          priceUnit: unitLabel.unit,
          tiers: [
            {
              tierLabel: unitLabelText,
              inputPrice: null,
              outputPrice: price,
              cachePrice: null,
              minTokens: null,
              maxTokens: null,
              unit: unitLabel.unit,
            },
          ],
        });
        return;
      }
      if (idKind !== undefined) return; // 分区明确但单位认不出(如每千字符):不收
    }

    // ---- 文本模型行:格标签分组(时段/输入长度阶梯)+ 输入/输出/缓存列位 ----
    // 页面 2026-11-17 形态:每个价格格自带标签行(「费用发生时段: …」或
    // 「输入 [0, 128k)」);缓存格可为「-」且**不带标签** → 继承前一格的标签,
    // 否则列位错位。组内列位 0=输入 1=输出 2=缓存(可缺省)。
    const groups = new Map<string, PriceCell[]>();
    const order: string[] = [];
    let currentLabel: string | null = null;
    kids.slice(1).each((_, c) => {
      const firstSpan = $(c)
        .find("span")
        .first()
        .text()
        .replace(/\u00a0/g, " ")
        .trim();
      if (firstSpan !== "") {
        currentLabel = firstSpan.replace(/^费用发生时段[:：]\s*/, "").trim();
      }
      const priceText = $(c).find("span.tabular-nums").first().text().trim();
      const priceMatch = priceText.match(/[¥￥]\s*([\d.]+)/);
      const cell: PriceCell = {
        label: currentLabel,
        price: priceMatch === null ? null : Number(priceMatch[1]),
      };
      const key = cell.label ?? "";
      if (!groups.has(key)) {
        groups.set(key, []);
        order.push(key);
      }
      groups.get(key)!.push(cell);
    });

    const tiers: ModelTierPrefill[] = [];
    const tierLabels: string[] = [];
    for (const key of order) {
      const cells = groups.get(key)!;
      if (cells.length > 3) {
        throw new Error(`siliconflow 价格列数异常(${cells.length}>3,页面可能改版)`);
      }
      const bounds = ladderBoundsOf(key);
      const tier: ModelTierPrefill = {
        tierLabel: bounds === null ? (key === "" ? "默认" : key) : bounds.label,
        inputPrice: cells[0]?.price ?? null,
        outputPrice: cells[1]?.price ?? null,
        cachePrice: cells[2]?.price ?? null,
        minTokens: bounds?.min ?? null,
        maxTokens: bounds?.max ?? null,
        unit: "per_1m_tokens",
      };
      tiers.push(tier);
      tierLabels.push(tier.tierLabel);
    }

    // 行价:有输入长度阶梯 → 取最小阶梯档(绝大多数请求落点,同火山口径);
    // 无阶梯(纯时段)→ 各时段最高价(保守基准:不把优惠窗当常态价)
    const bounded = tiers.filter((t) => t.minTokens !== null);
    const pool =
      bounded.length > 0
        ? [bounded.reduce((a, b) => ((b.minTokens ?? 0) < (a.minTokens ?? 0) ? b : a))]
        : tiers;
    const inputs = pool.map((t) => t.inputPrice).filter((v): v is number => v !== null);
    const outputs = pool.map((t) => t.outputPrice).filter((v): v is number => v !== null);
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
