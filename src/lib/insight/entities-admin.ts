/**
 * 实体聚合视图取数(M59 批B,data-expansion-plan §5.3 后续):/admin/insight/entities
 * 按 entity_event.entityKey 聚合厂商事件(实体 → 事件数/最近事件),详情页给事件
 * 时间线 + 经 insight_signal.meta.entityKey 关联的厂商信号。
 * 口径边界:只聚合 entity_event(厂商抽取链);榜单快照/社区信号未挂实体,不 join。
 * 列表两段式:groupBy 拿分组与计数(page 内),再按本页 key 集合补最近事件
 * (groupBy 不能带非聚合列);总数用 count(DISTINCT) 子查询(Prisma 无等价 API)。
 */
import { Prisma } from "@prisma/client";

import { parsePage } from "@/lib/admin/list";
import { DAY_MS, startOfCnDay } from "@/lib/datetime";
import { prisma } from "@/lib/db";

import { listSignalsByEntityKey, type InsightSignalRow } from "./admin";
import { isEntityType, type EntityType } from "./vendor/constants";
import { VENDOR_DEFS } from "./vendor/registry";

export const ENTITIES_PATH = "/admin/insight/entities/";

export const ENTITY_PAGE_SIZE = 50;

/** 详情页事件时间线上限(单实体事件很少,上限兜底防爆量) */
export const ENTITY_EVENT_TAKE = 120;

/** 详情页相关信号上限(与信号流缺省取数同口径) */
export const ENTITY_SIGNAL_TAKE = 50;

/** 时间窗 chips(近 N 天;不选=全部) */
export const ENTITY_WINDOWS = [7, 30, 90] as const;

/** 关键词长度上限(超长截断,避免超宽 ILIKE 模式) */
const QUERY_MAX = 40;

export interface EntityFilters {
  vendor?: string;
  entityType?: EntityType;
  /** 近 N 天(北京日界);undefined = 全部 */
  windowDays?: number;
  q?: string;
  page: number;
}

export interface EntityRow {
  entityKey: string;
  /** 最近事件的类型/厂商(实体内多厂商时取最近一条) */
  entityType: string;
  vendor: string;
  eventCount: number;
  lastAt: string;
  latestEventType: string;
  latestTitle: string;
  latestUrl: string;
}

export interface EntityPage {
  rows: EntityRow[];
  total: number;
  page: number;
  pages: number;
}

export interface EntityDetail {
  entityKey: string;
  eventCount: number;
  /** 本实体涉及的全部厂商/类型(详情头部徽章) */
  vendors: string[];
  entityTypes: string[];
  events: EntityEventLite[];
  signals: InsightSignalRow[];
}

/** 详情事件行(与 events 页 EntityEventRow 同形,去掉筛选无关字段) */
export interface EntityEventLite {
  dedupeKey: string;
  vendor: string;
  entityType: string;
  eventType: string;
  title: string;
  summary: string | null;
  url: string;
  occurredAt: string;
}

/** 关键词清洗:trim + 截断 + 去 ILIKE 元字符(% _ \),空串不筛 */
export function sanitizeEntityQuery(raw: string | undefined): string | undefined {
  const cleaned = (raw ?? "")
    .trim()
    .slice(0, QUERY_MAX)
    .replace(/[%_\\]/g, "");
  return cleaned === "" ? undefined : cleaned;
}

/** 页侧参数钳制(唯一出口):vendor/type/window 白名单外丢弃,page 非法回 1 */
export function resolveEntityFilters(raw: Record<string, string | undefined>): EntityFilters {
  return {
    vendor: VENDOR_DEFS.some((d) => d.key === raw.vendor) ? raw.vendor : undefined,
    entityType: isEntityType(raw.entityType) ? raw.entityType : undefined,
    windowDays: ENTITY_WINDOWS.find((n) => String(n) === raw.window),
    q: sanitizeEntityQuery(raw.q),
    page: parsePage(raw.page),
  };
}

/** 实体详情路径(单源;按段编码,保住 entityKey 里的 / 分隔)。
 * 尾斜杠随 `next.config` 的 trailingSlash 走,但末段含「.」时 Next 当文件路径处理、
 * canonical 形态是**无**尾斜杠(带斜杠会 308),链接必须直指 canonical,免每次点击一跳。 */
export function entityHref(entityKey: string): string {
  const seg = entityKey.split("/").map(encodeURIComponent).join("/");
  const last = seg.slice(seg.lastIndexOf("/") + 1);
  return `${ENTITIES_PATH}${seg}${last.includes(".") ? "" : "/"}`;
}

/** 列表链接(空值不落串,page>1 才携带) */
export function entityListHref(
  filters: EntityFilters,
  overrides: Partial<EntityFilters> = {},
): string {
  const merged = { ...filters, ...overrides };
  const sp = new URLSearchParams();
  if (merged.vendor !== undefined) sp.set("vendor", merged.vendor);
  if (merged.entityType !== undefined) sp.set("entityType", merged.entityType);
  if (merged.windowDays !== undefined) sp.set("window", String(merged.windowDays));
  if (merged.q !== undefined) sp.set("q", merged.q);
  if (merged.page > 1) sp.set("page", String(merged.page));
  const qs = sp.toString();
  return qs === "" ? ENTITIES_PATH : `${ENTITIES_PATH}?${qs}`;
}

/** 时间窗起点(北京日界,含当日:近 7 天=今日+前 6 日);无窗回 undefined */
function windowStart(windowDays: number | undefined, now: Date): Date | undefined {
  if (windowDays === undefined) return undefined;
  return new Date(startOfCnDay(now).getTime() - (windowDays - 1) * DAY_MS);
}

/** Prisma where 唯一出口(列表/补最近事件共用同一套筛选) */
export function buildEntityWhere(
  filters: EntityFilters,
  now: Date = new Date(),
): Prisma.EntityEventWhereInput {
  const since = windowStart(filters.windowDays, now);
  return {
    ...(filters.vendor === undefined ? {} : { vendor: filters.vendor }),
    ...(filters.entityType === undefined ? {} : { entityType: filters.entityType }),
    ...(filters.q === undefined
      ? {}
      : { entityKey: { contains: filters.q, mode: Prisma.QueryMode.insensitive } }),
    ...(since === undefined ? {} : { occurredAt: { gte: since } }),
  };
}

/** count(DISTINCT entity_key) 的 SQL 条件(与 buildEntityWhere 同一 filters 投影,
 * 两处相邻便于同步;仅用于总数子查询) */
function entityWhereSql(filters: EntityFilters, now: Date): Prisma.Sql {
  const conds: Prisma.Sql[] = [];
  if (filters.vendor !== undefined) conds.push(Prisma.sql`vendor = ${filters.vendor}`);
  if (filters.entityType !== undefined) conds.push(Prisma.sql`entity_type = ${filters.entityType}`);
  if (filters.q !== undefined) conds.push(Prisma.sql`entity_key ILIKE ${`%${filters.q}%`}`);
  const since = windowStart(filters.windowDays, now);
  if (since !== undefined) conds.push(Prisma.sql`occurred_at >= ${since}`);
  return conds.length === 0 ? Prisma.empty : Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}`;
}

/** 详情页 key 形态校验:必须是 normalizeEntityKey 的不动点,且不含空白/控制
 * 字符/URL 保留字符;允许 /(分赛道命名,由 catch-all 路由承接),拒绝 . / .. 段 */
export function isCanonicalEntityKey(key: string): boolean {
  if (key === "" || key.length > 120) return false;
  if (/[\s\\?#%\u0000-\u001f]/.test(key)) return false;
  if (key !== key.trim().toLowerCase().replace(/\s+/g, "-")) return false;
  return key.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/** 实体列表:本页分组(事件数/最近时间)+ 最近事件标题外链 + 总数 */
export async function listEntities(
  filters: EntityFilters,
  now: Date = new Date(),
): Promise<EntityPage> {
  const where = buildEntityWhere(filters, now);
  const whereSql = entityWhereSql(filters, now);
  const [groups, totals] = await Promise.all([
    prisma.entityEvent.groupBy({
      by: ["entityKey"],
      where,
      _count: { _all: true },
      _max: { occurredAt: true },
      orderBy: [{ _max: { occurredAt: "desc" } }, { entityKey: "asc" }],
      skip: (filters.page - 1) * ENTITY_PAGE_SIZE,
      take: ENTITY_PAGE_SIZE,
    }),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(DISTINCT entity_key) AS count FROM entity_event ${whereSql}
    `,
  ]);
  const total = Number(totals[0]?.count ?? 0);

  const keys = groups.map((g) => g.entityKey);
  const latest =
    keys.length === 0
      ? []
      : await prisma.entityEvent.findMany({
          where: { ...where, entityKey: { in: keys } },
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          select: {
            entityKey: true,
            vendor: true,
            entityType: true,
            eventType: true,
            title: true,
            url: true,
          },
        });
  // 已按 occurredAt 倒序:每个 key 首条即最近事件
  const latestOf = new Map<string, (typeof latest)[number]>();
  for (const e of latest) if (!latestOf.has(e.entityKey)) latestOf.set(e.entityKey, e);

  const rows: EntityRow[] = groups.map((g) => {
    const l = latestOf.get(g.entityKey);
    return {
      entityKey: g.entityKey,
      entityType: l?.entityType ?? "",
      vendor: l?.vendor ?? "",
      eventCount: g._count._all,
      lastAt: (g._max.occurredAt ?? new Date(0)).toISOString(),
      latestEventType: l?.eventType ?? "",
      latestTitle: l?.title ?? g.entityKey,
      latestUrl: l?.url ?? "",
    };
  });
  return {
    rows,
    total,
    page: filters.page,
    pages: Math.max(1, Math.ceil(total / ENTITY_PAGE_SIZE)),
  };
}

/** 实体详情:事件时间线 + 经 meta.entityKey 关联的厂商信号;两边皆空回 null */
export async function getEntityDetail(entityKey: string): Promise<EntityDetail | null> {
  const [events, signals, eventCount, facets] = await Promise.all([
    prisma.entityEvent.findMany({
      where: { entityKey },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: ENTITY_EVENT_TAKE,
      select: {
        dedupeKey: true,
        vendor: true,
        entityType: true,
        eventType: true,
        title: true,
        summary: true,
        url: true,
        occurredAt: true,
      },
    }),
    listSignalsByEntityKey(entityKey, ENTITY_SIGNAL_TAKE),
    prisma.entityEvent.count({ where: { entityKey } }),
    prisma.entityEvent.groupBy({
      by: ["vendor", "entityType"],
      where: { entityKey },
      _count: { _all: true },
    }),
  ]);
  if (eventCount === 0 && signals.length === 0) return null;
  return {
    entityKey,
    eventCount,
    vendors: [...new Set(facets.map((f) => f.vendor))].sort(),
    entityTypes: [...new Set(facets.map((f) => f.entityType))].sort(),
    events: events.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() })),
    signals,
  };
}
