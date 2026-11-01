/**
 * 厂商事件后台查询(M58 批②,data-expansion-plan §5.3):/admin/insight/events
 * 取数。只读页服务端直查,不设读 API;筛选值经词表白名单钳制(非法即不筛)。
 * 时间窗按北京日界(occurred_at 是事件发生时间,不是采集时间)。
 */
import { prisma } from "@/lib/db";
import { isRealDay } from "@/lib/datetime";

import { EVENT_TYPES, isEntityEventType } from "./vendor/constants";
import { VENDOR_DEFS } from "./vendor/registry";

export const EVENT_DEFAULT_LIMIT = 50;
const EVENT_MAX_LIMIT = 200;

export interface EntityEventFilters {
  vendor?: string;
  eventType?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface EntityEventRow {
  dedupeKey: string;
  vendor: string;
  entityType: string;
  entityKey: string;
  eventType: string;
  title: string;
  summary: string | null;
  url: string;
  occurredAt: string;
}

/** 厂商 key → 展示名(events 页与筛选 chips 同源) */
export const VENDOR_LABELS: Record<string, string> = Object.fromEntries(
  VENDOR_DEFS.map((d) => [d.key, d.vendorName]),
);

export const EVENT_TYPE_OPTIONS = EVENT_TYPES;

/** 页侧参数钳制(唯一出口):非法 vendor/type 丢弃,非法日期丢弃 */
export function resolveEventFilters(raw: Record<string, string | undefined>): EntityEventFilters {
  const vendor = VENDOR_DEFS.some((d) => d.key === raw.vendor) ? raw.vendor : undefined;
  const eventType = isEntityEventType(raw.eventType) ? raw.eventType : undefined;
  const from = isRealDay(raw.from) ? raw.from : undefined;
  const to = isRealDay(raw.to) ? raw.to : undefined;
  const limitRaw = Number(raw.limit);
  const limit =
    Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= EVENT_MAX_LIMIT
      ? limitRaw
      : EVENT_DEFAULT_LIMIT;
  return { vendor, eventType, from, to, limit };
}

export async function listEntityEvents(filters: EntityEventFilters): Promise<EntityEventRow[]> {
  const occurredAt: { gte?: Date; lt?: Date } = {};
  if (filters.from) occurredAt.gte = new Date(`${filters.from}T00:00:00+08:00`);
  if (filters.to) {
    const next = new Date(`${filters.to}T00:00:00+08:00`);
    next.setUTCDate(next.getUTCDate() + 1);
    occurredAt.lt = next;
  }
  const rows = await prisma.insightEntityEvent.findMany({
    where: {
      ...(filters.vendor ? { vendor: filters.vendor } : {}),
      ...(filters.eventType ? { eventType: filters.eventType } : {}),
      ...(occurredAt.gte || occurredAt.lt ? { occurredAt } : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: filters.limit ?? EVENT_DEFAULT_LIMIT,
    select: {
      dedupeKey: true,
      vendor: true,
      entityType: true,
      entityKey: true,
      eventType: true,
      title: true,
      summary: true,
      url: true,
      occurredAt: true,
    },
  });
  return rows.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() }));
}
