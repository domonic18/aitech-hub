/**
 * OpenRouter 预填通道(M55 批B):/api/v1/models 公开端点拉 400+ 模型结构化
 * 牌价(USD/token 字符串),按厂商白名单映射落 model_pricing 初稿。三通道纪律:
 * 预填永远只产/刷 pending 初稿,enabled/disabled(人工终审)行不覆盖;
 * USD 原币直出不折算(D4);免费变体(:free)与时段折扣不收(D7)。
 * OpenRouter 价=其平台价,终审时须对官方牌价页核对(批C 爬虫初稿同为比对源)。
 */
import { z } from "zod";

import { prisma } from "@/lib/db";

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/** 厂商白名单:OpenRouter slug → 本站厂商名/分组(2026-10-28 实测 slug 分布) */
export const OPENROUTER_VENDORS: Readonly<
  Record<string, { vendor: string; region: "cn" | "intl" }>
> = {
  deepseek: { vendor: "DeepSeek 深度求索", region: "cn" },
  "z-ai": { vendor: "智谱 AI · BigModel", region: "cn" },
  qwen: { vendor: "阿里巴巴 · 通义百炼", region: "cn" },
  bytedance: { vendor: "字节跳动 · 火山方舟", region: "cn" },
  moonshotai: { vendor: "月之暗面 Moonshot", region: "cn" },
  minimax: { vendor: "MiniMax 稀宇科技", region: "cn" },
  openai: { vendor: "OpenAI", region: "intl" },
  anthropic: { vendor: "Anthropic", region: "intl" },
  google: { vendor: "Google", region: "intl" },
};

/** USD/token 字符串 → USD/百万 tokens(≥0 数值;非法/负值=null 不臆测) */
export function usdPerTokenToPerMillion(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1_000_000 * 1e6) / 1e6;
}

const contract = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      context_length: z.number().int().positive().nullable().optional(),
      pricing: z.object({
        prompt: z.string(),
        completion: z.string(),
      }),
    }),
  ),
});

export type OpenRouterModel = z.infer<typeof contract>["data"][number];

export interface PrefillRow {
  vendor: string;
  modelKey: string;
  currency: "USD";
  inputPrice: number | null;
  outputPrice: number | null;
  contextWindow: string | null;
  note: string;
  dataAsOf: Date;
  sourceUrl: string;
  region: "cn" | "intl";
}

/** 响应 → 白名单内初稿行(纯函数,单测锚):免费变体/白名单外跳过 */
export function mapOpenRouterModels(models: OpenRouterModel[], now: Date): PrefillRow[] {
  const rows: PrefillRow[] = [];
  for (const m of models) {
    if (m.id.endsWith(":free")) continue; // 免费变体=平台促销噪音
    const slug = m.id.split("/")[0] ?? "";
    const mapped = OPENROUTER_VENDORS[slug];
    if (mapped === undefined) continue;
    const inputPrice = usdPerTokenToPerMillion(m.pricing.prompt);
    const outputPrice = usdPerTokenToPerMillion(m.pricing.completion);
    if (inputPrice === null && outputPrice === null) continue; // 双价皆缺不臆测
    rows.push({
      vendor: mapped.vendor,
      modelKey: m.id.split("/").slice(1).join("/"),
      currency: "USD",
      inputPrice,
      outputPrice,
      contextWindow:
        m.context_length === undefined || m.context_length === null
          ? null
          : `${Math.round(m.context_length / 1024)}K`,
      note: `[openrouter 预填 ${now.toISOString().slice(0, 10)}] 平台价,终审须对官方牌价页`,
      dataAsOf: now,
      sourceUrl: `${OPENROUTER_MODELS_URL.replace("/api/v1/models", "")}/${m.id}`,
      region: mapped.region,
    });
  }
  return rows;
}

export interface OpenRouterSyncSummary {
  fetched: number;
  mapped: number;
  created: number;
  refreshed: number;
  untouched: number;
  failed: number;
}

/** 拉取 + 映射 + 落库(初稿规则:pending 刷新,enabled/disabled 不动)。永不 throw?否:
 * 网络失败上抛由调用方(路由 502 / worker 重试)处理;单行落库失败自吞计数。 */
export async function syncOpenrouterPrefill(
  fetchModels: () => Promise<unknown> = async () => {
    const res = await fetch(OPENROUTER_MODELS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`openrouter http ${res.status}`);
    return res.json();
  },
  now: Date = new Date(),
): Promise<OpenRouterSyncSummary> {
  const parsed = contract.parse(await fetchModels());
  const rows = mapOpenRouterModels(parsed.data, now);
  const summary: OpenRouterSyncSummary = {
    fetched: parsed.data.length,
    mapped: rows.length,
    created: 0,
    refreshed: 0,
    untouched: 0,
    failed: 0,
  };

  const vendors = [...new Set(rows.map((r) => r.vendor))];
  const existing = await prisma.modelPricing.findMany({
    where: { vendor: { in: vendors }, modelKey: { in: rows.map((r) => r.modelKey) } },
    select: { id: true, vendor: true, modelKey: true, status: true },
  });
  const byKey = new Map(existing.map((e) => [`${e.vendor}|${e.modelKey}`, e]));

  for (const r of rows) {
    const hit = byKey.get(`${r.vendor}|${r.modelKey}`);
    try {
      if (hit === undefined) {
        await prisma.modelPricing.create({
          data: {
            vendor: r.vendor,
            modelKey: r.modelKey,
            currency: "USD",
            inputPrice: r.inputPrice,
            outputPrice: r.outputPrice,
            contextWindow: r.contextWindow,
            note: r.note,
            dataAsOf: r.dataAsOf,
            sourceUrl: r.sourceUrl,
            region: r.region,
            status: "pending",
          },
          select: { id: true },
        });
        summary.created += 1;
      } else if (hit.status === "pending") {
        await prisma.modelPricing.update({
          where: { id: hit.id },
          data: {
            inputPrice: r.inputPrice,
            outputPrice: r.outputPrice,
            contextWindow: r.contextWindow,
            note: r.note,
            dataAsOf: r.dataAsOf,
            sourceUrl: r.sourceUrl,
          },
          select: { id: true },
        });
        summary.refreshed += 1;
      } else {
        summary.untouched += 1; // 人工终审行,预填不覆盖
      }
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}
