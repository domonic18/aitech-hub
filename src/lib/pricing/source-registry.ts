/**
 * 牌价渠道注册表·代码侧真相源(M56 批B;2026-10-29 验收反馈:渠道统一并入
 * 采集渠道 crawl_source 体系维护):
 * - 解析器/取数器/默认 URL 按 key 注册在本文件(改解析逻辑才发版);
 * - 渠道行落 crawl_source(type=pricing,config.pricingKey 路由),URL/启停/
 *   采集周期(crawlIntervalMin,默认周级)在 数据中心·源管理·采集渠道 后台
 *   可调零发版,与文字渠道同一套调度(tick 扫 due)/健康度/台账;
 * - 渲染白名单 RENDER_ALLOWED_HOSTS 为渲染侧 host 兜底闸(compose 层),
 *   与本表 host 集合的同步关系见 compose 注释(新 host 渠道接入时两处同步)。
 * 失败语义:单源失败抛错 → crawlSource 通用 catch 记 consecutiveFails/健康度;
 * 本模块在抛错前先把该源旧数据按 sourceUrl 打「待复核」标(不静默腐烂)。
 * 快照档案(2026-10-29):每次采集由 SourceCapture 把取数原文(+整页截图)在
 * 解析之前落私有桶,crawl_snapshot 记结论;后台 数据中心·源管理 渠道行「快照」
 * 可回溯(页面改版当天,失败的原文恰恰是唯一证据)。
 */
import { prisma } from "@/lib/db";

import { PRICING_CRAWL_INTERVAL_MIN } from "../collect/constants";
import { SourceCapture, type SnapshotSink } from "../collect/snapshot-capture";
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
  BAILIAN_CODING_URL,
  fetchBailianCoding,
  fetchGlmCoding,
  fetchKimiMember,
  fetchMiniMaxMember,
  fetchXiaomiToken,
  GLM_CODING_URL,
  KIMI_MEMBER_URL,
  markPlanSourceStale,
  MINIMAX_MPLAN_URL,
  parseBailianCoding,
  parseGlmCoding,
  parseKimiCoding,
  parseMiniMaxCoding,
  parseXiaomiToken,
  persistPlanRows,
  type PlanPrefillRow,
  XIAOMI_TOKEN_URL,
} from "./plan-sources";

type AnyRow = ModelPrefillRow | PlanPrefillRow;

/** 取数上下文:now 供 dataAsOf/注记;sink 为快照回调(原文落档,编排层注入) */
export interface SourceContext {
  now: Date;
  sink: SnapshotSink;
}

export interface SourceDef {
  key: string;
  target: "model" | "plan";
  kind: "static" | "rendered";
  label: string;
  vendor: string;
  defaultUrl: string;
  sortOrder: number;
  /** 取数+解析(URL 由 DB 行传入,后台可调零发版);抛错=源失败 */
  run: (url: string, ctx: SourceContext) => Promise<AnyRow[]>;
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
    run: async (url, { now, sink }) => {
      // crawlModelSource 自吞取数失败 → 此处转抛(编排层统一捕获记源失败)
      const r = await crawlModelSource(
        "static",
        url,
        (h, u, n) => parseDeepseek(h, u, n),
        now,
        sink,
      );
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
    run: async (url, { now, sink }) => {
      const r = await crawlModelSource(
        "static",
        url,
        (h, u, n) => parseMoonshot(h, u, n),
        now,
        sink,
      );
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
    run: async (url, { now, sink }) => parseKimiCoding(await fetchKimiMember(url, sink), url, now),
  },
  {
    key: "minimax-mplan",
    target: "plan",
    kind: "rendered",
    label: "MiniMax M Plan 套餐",
    vendor: "MiniMax 稀宇科技",
    defaultUrl: MINIMAX_MPLAN_URL,
    sortOrder: 5,
    run: async (url, { now, sink }) =>
      parseMiniMaxCoding(await fetchMiniMaxMember(url, sink), url, now),
  },
  {
    key: "xiaomi-mimo",
    target: "plan",
    kind: "rendered",
    label: "小米 MiMo Token Plan",
    vendor: "小米 MiMo",
    defaultUrl: XIAOMI_TOKEN_URL,
    sortOrder: 6,
    run: async (url, { now, sink }) =>
      parseXiaomiToken(await fetchXiaomiToken(url, sink), url, now),
  },
  {
    key: "bailian-coding",
    target: "plan",
    kind: "static",
    label: "阿里云百炼 Coding Plan",
    vendor: "阿里云百炼",
    defaultUrl: BAILIAN_CODING_URL,
    sortOrder: 7,
    run: async (url, { now, sink }) =>
      parseBailianCoding(await fetchBailianCoding(url, sink), url, now),
  },
  {
    key: "glm-coding",
    target: "plan",
    kind: "rendered",
    label: "GLM Coding 套餐",
    vendor: "智谱 AI · BigModel",
    defaultUrl: GLM_CODING_URL,
    sortOrder: 8,
    run: async (url, { now, sink }) => parseGlmCoding(await fetchGlmCoding(url, sink), url, now),
  },
];

export interface PricingSourceCrawlResult {
  ok: boolean;
  /** 解析出的模型行+套餐行总数(供 crawlSource 台账 fetched) */
  fetched: number;
  error?: string;
}

/** 单牌价渠道爬取(crawlSource type=pricing 分发入口):
 * config.pricingKey → def → 取数(原文快照落档)+解析+按 target 落库三规则;
 * 失败先打该源旧数据「待复核」标再抛错(crawlSource 通用 catch 记健康度)。 */
export async function runPricingSourceCrawl(
  source: { id: number; url: string; config: unknown },
  now: Date = new Date(),
): Promise<PricingSourceCrawlResult> {
  const key =
    typeof source.config === "object" && source.config !== null && "pricingKey" in source.config
      ? String((source.config as Record<string, unknown>).pricingKey)
      : "";
  const def = SOURCE_DEFS.find((d) => d.key === key);
  if (def === undefined) {
    throw new Error(`pricing 渠道 key=${key || "(空)"} 无注册解析器(config.pricingKey)`);
  }
  const capture = new SourceCapture(source.id, source.url);
  try {
    const rows = await def.run(source.url, { now, sink: (draft) => capture.capture(draft) });
    const modelRows = rows.filter((r): r is ModelPrefillRow => "modelKey" in r);
    const planRows = rows.filter((r): r is PlanPrefillRow => "planName" in r);
    await persistModelRows(modelRows);
    await persistPlanRows(planRows);
    await capture.finish(rows.length === 0 ? "empty" : "success", rows.length);
    return { ok: true, fetched: rows.length };
  } catch (e) {
    const marked =
      (await markModelSourceStale(source.url, now)) + (await markPlanSourceStale(source.url, now));
    const message = `${e instanceof Error ? e.message : String(e)};已标待复核 ${marked} 行`;
    await capture.finish("failed", null, message);
    throw new Error(message);
  }
}

/** 渠道种子幂等(crawl_source 只补缺不改值):url/启停/周期归后台所有
 * (数据中心·源管理·采集渠道维护);config.pricingKey 路由代码侧解析器。 */
export async function syncPricingChannels(): Promise<number> {
  let created = 0;
  for (const def of SOURCE_DEFS) {
    const name = `pricing:${def.key}`;
    const r = await prisma.crawlSource.upsert({
      where: { name },
      update: {},
      create: {
        name,
        type: "pricing",
        url: def.defaultUrl,
        crawlIntervalMin: PRICING_CRAWL_INTERVAL_MIN, // 周级(官方牌价页礼貌采集;源管理可调)
        enabled: true,
        config: { pricingKey: def.key },
        remark: def.label,
      },
      select: { id: true },
    });
    if (r !== null) created += 1;
  }
  return created;
}
