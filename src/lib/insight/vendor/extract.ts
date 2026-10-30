/**
 * 厂商事件抽取编排(M58 批②,data-expansion-plan §5.2):单篇文章 → 结构化事件。
 *
 * 契约解析/规范名/时间兜底/幂等锚在 ./contract(纯函数单测);本文件只做
 * 模型解析、正文抓取、落库与信号入池:
 * - entity_event upsert 以 dedupeKey 幂等(同事件恒一条);
 * - 事件同时按 dedupeKey 作 refId 入洞察信号池(source=vendor-<key>),
 *   保证厂商发布能进热点簇;同一 URL 只入一次;
 * - 无可抽事件记空跑不落库;单事件入库失败不连坐同篇其余事件。
 *
 * 失败隔离:本任务抛错只记 job 失败(删 job + 释放 Redis 标记供下轮重试),
 * 不回写 crawl_source 健康度——抓取成功即健康(方案 §5.2)。
 * 未绑定模型 = 降级跳过(不抛错),标记照释,绑定后自然补抽。
 */
import { AI_PURPOSE_INSIGHT } from "@/lib/ai/constants";
import { chatJsonTask } from "@/lib/ai/chat-json-task";
import { readExtraMaxTokens, readExtraOutputConfig } from "@/lib/ai/extra-params";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { stripHtml } from "@/lib/telegram/normalize";

import { ingestInsightSignal } from "../ingest";
import { resolveEntity } from "../entities/resolve";
import { resolveInsightModel } from "../model";
import {
  ENTITY_TYPES,
  ENTITY_TYPE_LABELS,
  EVENT_TYPES,
  EVENT_TYPE_LABELS,
  VENDOR_MAX_EVENTS_PER_ARTICLE,
  VENDOR_TEXT_MAX,
  VENDOR_TEXT_MIN_FOR_FETCH,
} from "./constants";
import {
  SUMMARY_MAX,
  normalizeEntityKey,
  parseVendorEvents,
  resolveOccurredAt,
  vendorDedupeKey,
} from "./contract";
import { releaseVendorSeen, type VendorExtractJobData } from "./crawl";
import { resolveVendorDef } from "./registry";

const CRAWLER_UA = "aitech-hub-crawler/0.1 (+https://17aitech.com)";
const FETCH_TIMEOUT_MS = 15_000;

const EVENT_TYPE_LIST = EVENT_TYPES.map((t) => `${t}(${EVENT_TYPE_LABELS[t]})`).join("、");
const ENTITY_TYPE_LIST_ZH = ENTITY_TYPES.map((t) => `${t}(${ENTITY_TYPE_LABELS[t]})`).join("、");

const EXTRACT_SYSTEM = `你是 AI 行业事件抽取器。给定一家 AI 厂商的一篇官方文章,抽取其中的**可结构化事件**。

事件类型(只能取以下值之一):${EVENT_TYPE_LIST}。
实体类型:${ENTITY_TYPE_LIST_ZH}。

规则:
1. 只抽明确发生的事实;文章纯观点/教程/活动预告无事实事件时输出 {"events":[]}。
2. 单篇最多 ${VENDOR_MAX_EVENTS_PER_ARTICLE} 个最重要的事件。
3. entityKey 用稳定规范名(模型名/产品名/组织名,小写,空格转连字符,如 gpt-5、claude-sonnet-4-5、deepseek-v4);不要带版本修饰词以外的描述。
4. occurredAt 用 YYYY-MM-DD;文中无明确日期则 null(不要臆造)。
5. title ≤80 字,概括事件本身(谁发布/调整了什么);summary ≤${SUMMARY_MAX} 字,补充关键事实(版本、价格、benchmark 分数等)。
6. 只输出一个 JSON 对象:{"events":[...]},不要任何解释或代码块标记。`;

/** 实体解析降级包装:建实体失败只记 warn,事件照常入库(entityId 留空) */
async function resolveEntityIdSafely(
  vendorKey: string,
  entityKey: string,
  entityType: string,
): Promise<bigint | null> {
  try {
    const resolved = await resolveEntity({ vendorKey, rawKey: entityKey, entityType });
    return resolved?.id ?? null;
  } catch (e) {
    logger.warn({
      event: "insight.entity.resolve_failed",
      vendor: vendorKey,
      entityKey,
      error: String(e),
    });
    return null;
  }
}

/** 抽取输入:标题+摘要优先;不足 200 字再抓正文(列表页只有锚文本的源)
 * 抓取失败不阻断——标题仍是可用输入,记日志供回溯 */ async function readArticleText(
  item: VendorExtractJobData["item"],
): Promise<string> {
  let text = `${item.title}。${item.summary}`.trim();
  if (text.length < VENDOR_TEXT_MIN_FOR_FETCH) {
    try {
      const res = await fetch(item.url, {
        headers: { "user-agent": CRAWLER_UA },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) text = `${text} ${stripHtml(await res.text())}`.trim();
    } catch (e) {
      logger.warn({
        event: "insight.vendor.article_fetch_failed",
        url: item.url,
        error: String(e),
      });
    }
  }
  return text.slice(0, VENDOR_TEXT_MAX);
}

export interface VendorExtractResult {
  events: number;
  dropped: number;
  signals: number;
  empty: boolean;
}

/**
 * 单篇抽取(BullMQ 入口):LLM 抽事件 → entity_event upsert → 事件入洞察信号池。
 * 未绑定模型返回 empty=true 并释放标记(绑定后下轮自然补抽);
 * 终态失败抛错(记 job 失败 + 释标记 + 日志带 URL 供补跑),不影响源健康度。
 */
export async function runVendorExtractJob(
  data: VendorExtractJobData,
): Promise<VendorExtractResult> {
  const now = new Date();
  const fallback = data.item.publishedAt === null ? null : new Date(data.item.publishedAt);
  // 源标识以注册表为准(载荷只携带 vendorKey,队列数据无法漂出白名单)
  const def = resolveVendorDef({ vendorKey: data.vendorKey });
  if (def === null) throw new Error(`vendor key=${data.vendorKey} 未注册`);
  const source = def.insightSource;
  try {
    const model = await resolveInsightModel(AI_PURPOSE_INSIGHT);
    if (model === null) {
      await releaseVendorSeen(data.vendorKey, data.item.url);
      return { events: 0, dropped: 0, signals: 0, empty: true };
    }
    const text = await readArticleText(data.item);
    // 预算/思考深度只住 ai_model.extra_params(代码零数值默认,同 extra-params 口径):
    // 硬编码 1200 时 MiniMax 的 thinking 块会把预算吃满 → 无 text 块 → 整篇判死
    // (2026-10-30 E2E:56 次抽取 31 次此因)。台账未配预算时回退 1200 兜底。
    const contract = await chatJsonTask(
      model,
      parseVendorEvents,
      EXTRACT_SYSTEM,
      `厂商:${data.vendorKey}\n文章标题:${data.item.title}\n发布日期:${data.item.publishedAt ?? "未知"}\n今天:${now.toISOString().slice(0, 10)}\n\n正文:\n${text}`,
      AI_PURPOSE_INSIGHT,
      {
        maxTokens: readExtraMaxTokens(model.extraParams) ?? 1200,
        outputConfig: readExtraOutputConfig(model.extraParams) ?? undefined,
      },
    );

    let events = 0;
    let signals = 0;
    for (const draft of contract.events) {
      const entityKey = normalizeEntityKey(draft.entityKey);
      if (entityKey === "") continue;
      const occurredAt = resolveOccurredAt(draft.occurredAt, fallback, now);
      const dedupeKey = vendorDedupeKey(source, data.item.url, draft.eventType, entityKey);
      // M60:解析到规范实体(主表+别名)。失败只降级留空,不阻断事件入库;
      // 未解析的事件由回填脚本按历史顺序补挂。
      const entityId = await resolveEntityIdSafely(data.vendorKey, entityKey, draft.entityType);
      const entityPatch = entityId === null ? {} : { entityId };
      const meta = {
        vendor: data.vendorKey,
        entityType: draft.entityType,
        entityKey,
        eventType: draft.eventType,
        url: data.item.url,
      };
      try {
        await prisma.entityEvent.upsert({
          where: { dedupeKey },
          update: {
            title: draft.title,
            summary: draft.summary || null,
            occurredAt,
            ...entityPatch,
          },
          create: {
            source,
            vendor: data.vendorKey,
            entityType: draft.entityType,
            entityKey,
            eventType: draft.eventType,
            title: draft.title,
            summary: draft.summary || null,
            url: data.item.url.slice(0, 500),
            occurredAt,
            dedupeKey,
            meta,
            ...entityPatch,
          },
        });
      } catch (e) {
        // 单事件入库失败不连坐同篇其余事件(下轮重跑幂等自愈)
        logger.warn({
          event: "insight.vendor.event_upsert_failed",
          url: data.item.url,
          error: String(e),
        });
        continue;
      }
      events += 1;
      const rawText = draft.summary === "" ? draft.title : `${draft.title}。${draft.summary}`;
      const outcome = await ingestInsightSignal({
        source,
        refId: dedupeKey,
        rawText,
        signalAt: occurredAt,
        meta,
      });
      if (outcome === "ingested") signals += 1;
    }
    return { events, dropped: contract.dropped, signals, empty: contract.events.length === 0 };
  } catch (e) {
    await releaseVendorSeen(data.vendorKey, data.item.url);
    logger.error({
      event: "insight.vendor.extract_failed",
      vendor: data.vendorKey,
      url: data.item.url,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
