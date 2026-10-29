/**
 * 牌价渠道注册表·代码侧真相源 + DB 驱动编排(M56 批B):
 * - 解析器/取数器/默认 URL 按 key 注册在本文件(改解析逻辑才发版);
 * - URL/启停落 pricing_source 表后台可调零发版(策展台渠道管理块;
 *   syncPricingSources 幂等种子只补缺不改值——url/enabled 归后台所有);
 * - 渲染白名单 RENDER_ALLOWED_HOSTS 为渲染侧 host 兜底闸(compose 层),
 *   与本表 host 集合的同步关系见 compose 注释(新 host 渠道接入时两处同步)。
 * 失败编排:单源失败自吞爬取,成功源照常落库;收尾失败源旧数据打「待复核」,
 * 任一源失败整 job 上抛(job_run 记 failed 连败健康页可见,不静默腐烂)。
 */
import { prisma } from "@/lib/db";

import {
  DEEPSEEK_PRICING_URL,
  MOONSHOT_PRICING_URL,
  crawlModelSource,
  markModelSourceStale,
  parseDeepseek,
  parseMoonshot,
  persistModelRows,
  type ModelPrefillRow,
} from "./crawlers";
import {
  GLM_CODING_URL,
  KIMI_MEMBER_URL,
  crawlPlanSource,
  markPlanSourceStale,
  persistPlanRows,
  type PlanPrefillRow,
} from "./plan-sources";

type AnyRow = ModelPrefillRow | PlanPrefillRow;

export interface SourceDef {
  key: string;
  target: "model" | "plan";
  kind: "static" | "rendered";
  label: string;
  vendor: string;
  defaultUrl: string;
  sortOrder: number;
  /** 取数+解析(URL 由 DB 行传入,后台可调零发版);抛错=源失败 */
  run: (url: string, now: Date) => Promise<AnyRow[]>;
}

export const SOURCE_DEFS: SourceDef[] = [
  {
    key: "deepseek",
    target: "model",
    kind: "static",
    label: "DeepSeek 模型牌价",
    vendor: "DeepSeek 深度求索",
    defaultUrl: DEEPSEEK_PRICING_URL,
    sortOrder: 1,
    run: async (url, now) => {
      // crawlModelSource 自吞取数失败 → 此处转抛(编排层统一捕获记源失败)
      const r = await crawlModelSource("static", url, (h, u, n) => parseDeepseek(h, u, n), now);
      if (!r.ok) throw new Error(r.error ?? "deepseek 源失败");
      return r.rows;
    },
  },
  {
    key: "moonshot",
    target: "model",
    kind: "static",
    label: "Kimi 模型牌价",
    vendor: "月之暗面 Moonshot",
    defaultUrl: MOONSHOT_PRICING_URL,
    sortOrder: 2,
    run: async (url, now) => {
      const r = await crawlModelSource("static", url, (h, u, n) => parseMoonshot(h, u, n), now);
      if (!r.ok) throw new Error(r.error ?? "moonshot 源失败");
      return r.rows;
    },
  },
  {
    key: "kimi-membership",
    target: "plan",
    kind: "rendered",
    label: "Kimi 会员套餐",
    vendor: "月之暗面 Kimi",
    defaultUrl: KIMI_MEMBER_URL,
    sortOrder: 3,
    run: async (url, now) => {
      const r = await crawlPlanSource("kimi-membership", "rendered", url, now);
      if (!r.ok) throw new Error(r.error ?? "kimi-membership 源失败");
      return r.rows;
    },
  },
  {
    key: "glm-coding",
    target: "plan",
    kind: "rendered",
    label: "GLM Coding 套餐",
    vendor: "智谱 AI · BigModel",
    defaultUrl: GLM_CODING_URL,
    sortOrder: 4,
    run: async (url, now) => {
      const r = await crawlPlanSource("glm-coding", "rendered", url, now);
      if (!r.ok) throw new Error(r.error ?? "glm-coding 源失败");
      return r.rows;
    },
  },
];

export interface PricingSourceRow {
  key: string;
  target: string;
  kind: string;
  label: string;
  vendor: string;
  url: string;
  enabled: boolean;
}

/** 幂等种子:DB 缺则建(url 取默认);已存在不覆盖任何字段——url/enabled 归
 * 后台所有,vendor/label 等代码侧信息如需订正走显式迁移/脚本(同 agent_skill 惯例) */
export async function syncPricingSources(): Promise<number> {
  let created = 0;
  for (const def of SOURCE_DEFS) {
    const r = await prisma.pricingSource.upsert({
      where: { key: def.key },
      update: {},
      create: {
        key: def.key,
        target: def.target,
        kind: def.kind,
        label: def.label,
        vendor: def.vendor,
        url: def.defaultUrl,
        enabled: true,
        sortOrder: def.sortOrder,
      },
      select: { id: true },
    });
    if (r !== null) created += 1;
  }
  return created;
}

/** DB enabled 渠道 → 可执行运行时源(def 补全;未知 key 跳过——代码侧未注册) */
export async function listEnabledSources(
  target: "model" | "plan",
): Promise<Array<{ key: string; url: string; label: string; run: SourceDef["run"] }>> {
  const rows = await prisma.pricingSource.findMany({
    where: { target, enabled: true },
    orderBy: [{ sortOrder: "asc" }],
  });
  const out: Array<{ key: string; url: string; label: string; run: SourceDef["run"] }> = [];
  for (const row of rows) {
    const def = SOURCE_DEFS.find((d) => d.key === row.key);
    if (def === undefined) continue; // DB 行先于代码(渠道已下线)→ 跳过
    out.push({ key: def.key, url: row.url, label: def.label, run: def.run });
  }
  return out;
}

export interface PricingCrawlSummary {
  models: {
    fetched: number;
    created: number;
    refreshed: number;
    untouched: number;
    failed: number;
    markedStale: number;
    sources: Array<{ source: string; ok: boolean; rows: number; error?: string }>;
  };
  plans: {
    created: number;
    refreshed: number;
    untouched: number;
    failed: number;
    markedStale: number;
    sources: Array<{ source: string; ok: boolean; rows: number; error?: string }>;
  };
}

/** 牌价爬虫总编排(DB 渠道驱动):模型面+套餐面双爬;任一源失败整 job 上抛
 * (成功源数据先落库不浪费;失败源旧数据打待复核——不静默腐烂)。 */
export async function runPricingCrawl(now: Date = new Date()): Promise<PricingCrawlSummary> {
  const errors: string[] = [];
  const summary: PricingCrawlSummary = {
    models: {
      fetched: 0,
      created: 0,
      refreshed: 0,
      untouched: 0,
      failed: 0,
      markedStale: 0,
      sources: [],
    },
    plans: {
      created: 0,
      refreshed: 0,
      untouched: 0,
      failed: 0,
      markedStale: 0,
      sources: [],
    },
  };

  // 模型面
  const modelSources = await listEnabledSources("model");
  const modelRows: ModelPrefillRow[] = [];
  for (const source of modelSources) {
    const r = await runSourceVia(source, now);
    summary.models.sources.push({
      source: source.key,
      ok: r.ok,
      rows: r.rows.length,
      error: r.error,
    });
    if (r.ok) modelRows.push(...(r.rows as ModelPrefillRow[]));
    else errors.push(`${source.key}(${r.error ?? "unknown"})`);
  }
  summary.models.fetched = modelRows.length;
  Object.assign(summary.models, await persistModelRows(modelRows));
  for (const s of modelSources) {
    const failed = summary.models.sources.find((x) => x.source === s.key && !x.ok);
    if (failed !== undefined) {
      const url = (
        await prisma.pricingSource.findUnique({ where: { key: s.key }, select: { url: true } })
      )?.url;
      if (url !== undefined) summary.models.markedStale += await markModelSourceStale(url, now);
    }
  }

  // 套餐面
  const planSources = await listEnabledSources("plan");
  const planRows: PlanPrefillRow[] = [];
  for (const source of planSources) {
    const r = await runSourceVia(source, now);
    summary.plans.sources.push({
      source: source.key,
      ok: r.ok,
      rows: r.rows.length,
      error: r.error,
    });
    if (r.ok) planRows.push(...(r.rows as PlanPrefillRow[]));
    else errors.push(`${source.key}(${r.error ?? "unknown"})`);
  }
  Object.assign(summary.plans, await persistPlanRows(planRows));
  for (const s of planSources) {
    const failed = summary.plans.sources.find((x) => x.source === s.key && !x.ok);
    if (failed !== undefined) {
      const url = (
        await prisma.pricingSource.findUnique({ where: { key: s.key }, select: { url: true } })
      )?.url;
      if (url !== undefined) summary.plans.markedStale += await markPlanSourceStale(url, now);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `pricing crawl 源失败: ${errors.join("; ")};已标待复核 ${
        summary.models.markedStale + summary.plans.markedStale
      } 行`,
    );
  }
  return summary;
}

/** 单源执行统一入口:def.run 抛错即源失败(成功源返回行) */
async function runSourceVia(
  source: { key: string; url: string; run: SourceDef["run"] },
  now: Date,
): Promise<{ ok: boolean; rows: AnyRow[]; error?: string }> {
  try {
    const rows = await source.run(source.url, now);
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}
