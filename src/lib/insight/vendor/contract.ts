/**
 * 厂商事件抽取契约(M58 批②,data-expansion-plan §5.2 纯函数段):
 * LLM 输出 {events:[...]} → Zod 校验 → 规范名/时间/幂等锚。
 * 与编排(extract.ts)分离:本模块零 DB/网络依赖,单测直白。
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import type { ParsedTask } from "@/lib/ai/chat-json-task";
import { extractJsonBlock } from "@/lib/ai/interpret-result";
import { canonicalUrl } from "@/lib/telegram/normalize";

import {
  ENTITY_TYPES,
  EVENT_MIN_YEAR,
  EVENT_TYPES,
  VENDOR_MAX_EVENTS_PER_ARTICLE,
  isEntityEventType,
  isEntityType,
  type EntityEventType,
  type EntityType,
} from "./constants";

export const SUMMARY_MAX = 500;

/** 事件类型同义归一(2026-10-30 E2E:56 次抽取 8 次因枚举漂移整篇判死,
 * 模型实际会输出 launch/pricing/benchmark 一类近义词)。仅收明确同义项;
 * 归一后仍非法即丢该条,不整篇判废。 */
const EVENT_TYPE_ALIASES: Record<string, EntityEventType> = {
  launch: "release",
  launched: "release",
  announce: "release",
  announcement: "release",
  new_release: "release",
  product_launch: "release",
  general_availability: "release",
  pricing: "price_change",
  price: "price_change",
  price_update: "price_change",
  pricing_change: "price_change",
  price_reduction: "price_change",
  price_cut: "price_change",
  price_increase: "price_change",
  opensource: "open_source",
  open_sourced: "open_source",
  open_sourcing: "open_source",
  open_weights: "open_source",
  funding_round: "funding",
  investment: "funding",
  invest: "funding",
  raise: "funding",
  financing: "funding",
  deprecate: "deprecation",
  deprecated: "deprecation",
  discontinue: "deprecation",
  discontinued: "deprecation",
  sunset: "deprecation",
  end_of_life: "deprecation",
  eol: "deprecation",
  retire: "deprecation",
  benchmark: "benchmark_change",
  benchmark_update: "benchmark_change",
  ranking: "benchmark_change",
  rank_change: "benchmark_change",
  leaderboard: "benchmark_change",
  leaderboard_change: "benchmark_change",
};

/** 实体类型同义归一(取值少,漂移集中在 org/company、product/tool) */
const ENTITY_TYPE_ALIASES: Record<string, EntityType> = {
  llm: "model",
  ai_model: "model",
  model_family: "model",
  foundation_model: "model",
  checkpoint: "model",
  tool: "product",
  app: "product",
  application: "product",
  service: "product",
  platform: "product",
  feature: "product",
  api: "product",
  organization: "org",
  organisation: "org",
  company: "org",
  firm: "org",
  team: "org",
  lab: "org",
  institution: "org",
};

/** 枚举词归一:小写 + 空白/连字符折成下划线(price change → price_change) */
function tokenOf(v: unknown): string {
  return typeof v === "string"
    ? v
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_")
    : "";
}

export function normalizeEventType(v: unknown): EntityEventType | null {
  const key = tokenOf(v);
  if (isEntityEventType(key)) return key;
  return EVENT_TYPE_ALIASES[key] ?? null;
}

export function normalizeEntityType(v: unknown): EntityType | null {
  const key = tokenOf(v);
  if (isEntityType(key)) return key;
  return ENTITY_TYPE_ALIASES[key] ?? null;
}

export const vendorEventSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityKey: z.string().trim().min(1).max(120),
  eventType: z.enum(EVENT_TYPES),
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().max(SUMMARY_MAX).optional().default(""),
  occurredAt: z.string().trim().nullable().optional(),
});

export type VendorEventDraft = z.infer<typeof vendorEventSchema>;

export interface VendorEventsContract {
  events: VendorEventDraft[];
  /** 被丢弃的事件数(超上限截断 + 单条不合契约) */
  dropped: number;
}

/** 契约解析(失败只回错误串,chatJsonTask 据此重试;永不 throw)。
 * 逐条解析:单条枚举漂移先归一,仍不合法只丢该条并计数;全部条目皆废才判失败
 * (交上层重试一次)。 */
export function parseVendorEvents(raw: string): ParsedTask<VendorEventsContract> {
  const block = extractJsonBlock(raw);
  if (block === null) return { ok: false, error: "输出中未找到 JSON 对象" };
  let json: unknown;
  try {
    json = JSON.parse(block);
  } catch (e) {
    return { ok: false, error: `JSON 解析失败:${e instanceof Error ? e.message : String(e)}` };
  }
  const list =
    typeof json === "object" && json !== null && "events" in json
      ? (json as { events: unknown }).events
      : undefined;
  if (!Array.isArray(list)) return { ok: false, error: "结构不符:events 不是数组" };

  const events: VendorEventDraft[] = [];
  let dropped = 0;
  let lastError = "";
  for (const item of list) {
    const candidate =
      typeof item === "object" && item !== null
        ? {
            ...item,
            entityType: normalizeEntityType((item as Record<string, unknown>).entityType),
            eventType: normalizeEventType((item as Record<string, unknown>).eventType),
          }
        : item;
    const parsed = vendorEventSchema.safeParse(candidate);
    if (parsed.success) events.push(parsed.data);
    else {
      dropped += 1;
      lastError = parsed.error.issues[0]?.message ?? "unknown";
    }
  }
  if (events.length === 0 && list.length > 0) return { ok: false, error: `结构不符:${lastError}` };

  const kept = events.slice(0, VENDOR_MAX_EVENTS_PER_ARTICLE);
  return {
    ok: true,
    data: { events: kept, dropped: dropped + (events.length - kept.length) },
  };
}

/** 实体规范名(与 prompt 同口径;Chinese 名不受影响) */
export function normalizeEntityKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 120);
}

/** 事件时间:显式日期 → 合理区间校验;缺失/越界回退列表页日期,再无=采集时间 */
export function resolveOccurredAt(
  raw: string | null | undefined,
  fallback: Date | null,
  now: Date,
): Date {
  if (typeof raw === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
    if (m !== null) {
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      const upper = now.getTime() + 24 * 3600 * 1000;
      if (
        !Number.isNaN(d.getTime()) &&
        d.getUTCMonth() === Number(m[2]) - 1 &&
        d.getUTCDate() === Number(m[3]) &&
        d.getUTCFullYear() >= EVENT_MIN_YEAR &&
        d.getTime() <= upper
      ) {
        return d;
      }
    }
  }
  return fallback ?? now;
}

/** 事件幂等锚(方案 §3 + entityKey 细化) */
export function vendorDedupeKey(
  source: string,
  url: string,
  eventType: string,
  entityKey: string,
): string {
  return createHash("sha1")
    .update(`${source}|${canonicalUrl(url)}|${eventType}|${entityKey}`)
    .digest("hex");
}
