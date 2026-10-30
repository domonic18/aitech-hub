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
} from "./constants";

export const SUMMARY_MAX = 500;

export const vendorEventSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityKey: z.string().trim().min(1).max(120),
  eventType: z.enum(EVENT_TYPES),
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().max(SUMMARY_MAX).optional().default(""),
  occurredAt: z.string().trim().nullable().optional(),
});

export const vendorEventsPayloadSchema = z.object({
  // 上限不硬卡:超量截断救底(与 summarize keywords 同取向)
  events: z.array(vendorEventSchema),
});

export type VendorEventDraft = z.infer<typeof vendorEventSchema>;

export interface VendorEventsContract {
  events: VendorEventDraft[];
  /** 超上限被截断的事件数(方案 §5.2 超量丢弃并计数) */
  dropped: number;
}

/** 契约解析(失败只回错误串,chatJsonTask 据此重试;永不 throw) */
export function parseVendorEvents(raw: string): ParsedTask<VendorEventsContract> {
  const block = extractJsonBlock(raw);
  if (block === null) return { ok: false, error: "输出中未找到 JSON 对象" };
  let json: unknown;
  try {
    json = JSON.parse(block);
  } catch (e) {
    return { ok: false, error: `JSON 解析失败:${e instanceof Error ? e.message : String(e)}` };
  }
  const parsed = vendorEventsPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: `结构不符:${parsed.error.issues[0]?.message ?? "unknown"}` };
  }
  const all = parsed.data.events;
  return {
    ok: true,
    data: {
      events: all.slice(0, VENDOR_MAX_EVENTS_PER_ARTICLE),
      dropped: Math.max(0, all.length - VENDOR_MAX_EVENTS_PER_ARTICLE),
    },
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
