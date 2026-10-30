/**
 * 实体聚合视图取数(M59 批B → M60 实体层):/admin/insight/entities。
 *
 * 读侧以 **insight_entity 为准**(实体主表 + 别名 + 父子层次),事件按
 * `entity_event.entity_id` 挂到实体;历史未回填(`entity_id IS NULL`)的条数
 * 单列提示,不混进实体行。列表按「顶层 org 分区 → 产品线 → 实体」折叠:
 * qwen-mt-turbo / qwen3-embedding / qwen-vlo 同挂 Qwen 之下,不再平铺。
 *
 * 分页按实体粒度(事件数/最近时间聚合后排序再切片),分区在页内成形;实体
 * 总量是「有事件的实体数」量级(几十～几千),页侧内存过滤/排序可接受,
 * 换来别名关键词命中与三层层次一次装配(避免逐实体 N+1)。
 */
import { parsePage } from "@/lib/admin/list";
import { DAY_MS, startOfCnDay } from "@/lib/datetime";
import { prisma } from "@/lib/db";

import { listSignalsByEntityKey, type InsightSignalRow } from "./admin";
import { findEntity } from "./entities/resolve";
import { isEntityType, type EntityType } from "./vendor/constants";
import { VENDOR_DEFS } from "./vendor/registry";

export const ENTITIES_PATH = "/admin/insight/entities/";

export const ENTITY_PAGE_SIZE = 50;

/** 详情页事件时间线上限(单实体事件很少,上限兜底防爆量) */
export const ENTITY_EVENT_TAKE = 120;

/** 详情页相关信号上限(与信号流缺省取数同口径) */
export const ENTITY_SIGNAL_TAKE = 50;

/** 详情页同族实体(子/兄弟)展示上限 */
export const ENTITY_RELATED_TAKE = 12;

/** 时间窗 chips(近 N 天;不选=全部) */
export const ENTITY_WINDOWS = [7, 30, 90] as const;

/** 层次最大深度(org → line → model;防脏数据成环时死循环) */
const MAX_DEPTH = 4;

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
  /** 规范键(详情路径锚) */
  key: string;
  displayName: string;
  entityType: string;
  vendorKey: string | null;
  /** 直接父级(产品线或品牌);顶层为 null */
  parentKey: string | null;
  parentName: string | null;
  /** 顶层品牌(分区锚) */
  rootKey: string;
  rootName: string;
  aliasCount: number;
  eventCount: number;
  lastAt: string;
  latestEventType: string;
  latestTitle: string;
  latestUrl: string;
}

export interface EntitySection {
  rootKey: string;
  rootName: string;
  eventCount: number;
  rows: EntityRow[];
}

export interface EntityPage {
  sections: EntitySection[];
  total: number;
  page: number;
  pages: number;
  /** 未挂实体的历史事件数(回填前/解析降级;单列提示) */
  unresolved: number;
}

export interface EntityLink {
  key: string;
  displayName: string;
  /** 事件数(父子/兄弟侧有;头部父级/品牌省略) */
  eventCount?: number;
}

export interface EntityDetail {
  key: string;
  displayName: string;
  entityType: string;
  vendorKey: string | null;
  parent: EntityLink | null;
  root: EntityLink | null;
  /** 全部别名(含规范键;详情「别名」chips) */
  aliases: string[];
  eventCount: number;
  vendors: string[];
  entityTypes: string[];
  events: EntityEventLite[];
  signals: InsightSignalRow[];
  children: EntityLink[];
  siblings: EntityLink[];
  /** 命中已归并实体时的跳转目标(页面据此 redirect) */
  redirectTo: string | null;
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

/** 实体详情路径(单源;按段编码,保住规范键里的 / 分隔)。
 * 尾斜杠随 `next.config` 的 trailingSlash 走,但末段含「.」时 Next 当文件路径处理、
 * canonical 形态是**无**尾斜杠(带斜杠会 308),链接必须直指 canonical。 */
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

/** 详情页 key 形态校验:必须是 normalizeEntityKey 的不动点,且不含空白/控制
 * 字符/URL 保留字符;允许 /(分赛道命名,由 catch-all 路由承接),拒绝 . / .. 段 */
export function isCanonicalEntityKey(key: string): boolean {
  if (key === "" || key.length > 120) return false;
  if (/[\s\\?#%\u0000-\u001f]/.test(key)) return false;
  if (key !== key.trim().toLowerCase().replace(/\s+/g, "-")) return false;
  return key.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

type EntityMeta = {
  id: bigint;
  key: string;
  displayName: string;
  entityType: string;
  vendorKey: string | null;
  parentId: bigint | null;
  status: string;
  mergedIntoId: bigint | null;
};

const META_SELECT = {
  id: true,
  key: true,
  displayName: true,
  entityType: true,
  vendorKey: true,
  parentId: true,
  status: true,
  mergedIntoId: true,
} as const;

/** 逐级向上取祖先(最多 MAX_DEPTH 层;脏数据成环时截断) */
async function loadAncestors(seeds: EntityMeta[]): Promise<Map<bigint, EntityMeta>> {
  const found = new Map<bigint, EntityMeta>(seeds.map((e) => [e.id, e]));
  let level: EntityMeta[] = seeds;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const want = [
      ...new Set(level.map((e) => e.parentId).filter((id): id is bigint => id !== null)),
    ].filter((id) => !found.has(id));
    if (want.length === 0) break;
    const rows: EntityMeta[] = await prisma.insightEntity.findMany({
      where: { id: { in: want } },
      select: META_SELECT,
    });
    for (const r of rows) found.set(r.id, r);
    level = rows;
  }
  return found;
}

/** 实体列表:事件聚合 → 过滤(厂商/类型/关键词含别名)→ 分页 → 顶层品牌分区 */
export async function listEntityTree(
  filters: EntityFilters,
  now: Date = new Date(),
): Promise<EntityPage> {
  const since = windowStart(filters.windowDays, now);
  const timeCond = since === undefined ? {} : { occurredAt: { gte: since } };
  const q = filters.q;

  const [stats, unresolved, aliasHits] = await Promise.all([
    prisma.entityEvent.groupBy({
      by: ["entityId"],
      where: { entityId: { not: null }, ...timeCond },
      _count: { _all: true },
      _max: { occurredAt: true },
      orderBy: [{ _max: { occurredAt: "desc" } }],
    }),
    prisma.entityEvent.count({ where: { entityId: null, ...timeCond } }),
    q === undefined
      ? Promise.resolve([])
      : prisma.insightEntityAlias.findMany({
          where: { aliasKey: { contains: q, mode: "insensitive" } },
          select: { entityId: true },
        }),
  ]);

  const ids = stats.map((s) => s.entityId).filter((id): id is bigint => id !== null);
  const metas: EntityMeta[] =
    ids.length === 0
      ? []
      : await prisma.insightEntity.findMany({
          where: { id: { in: ids }, status: "active" },
          select: META_SELECT,
        });
  const metaOf = new Map(metas.map((m) => [m.id, m]));
  const aliasEntityIds = new Set(aliasHits.map((a) => a.entityId));
  const needle = q?.toLowerCase();

  const matched = stats.flatMap((s) => {
    const meta = s.entityId === null ? undefined : metaOf.get(s.entityId);
    if (!meta || s.entityId === null) return [];
    if (filters.vendor !== undefined && meta.vendorKey !== filters.vendor) return [];
    if (filters.entityType !== undefined && meta.entityType !== filters.entityType) return [];
    if (
      needle !== undefined &&
      !meta.key.toLowerCase().includes(needle) &&
      !meta.displayName.toLowerCase().includes(needle) &&
      !aliasEntityIds.has(meta.id)
    ) {
      return [];
    }
    return [{ meta, count: s._count._all, lastAt: s._max.occurredAt ?? new Date(0) }];
  });

  const total = matched.length;
  const pageStart = (filters.page - 1) * ENTITY_PAGE_SIZE;
  const pageRows = matched.slice(pageStart, pageStart + ENTITY_PAGE_SIZE);
  const pageIds = pageRows.map((r) => r.meta.id);

  const ancestors = await loadAncestors(pageRows.map((r) => r.meta));
  const [latest, aliasCounts] = await Promise.all([
    pageIds.length === 0
      ? Promise.resolve([])
      : prisma.entityEvent.findMany({
          where: { entityId: { in: pageIds }, ...timeCond },
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          select: {
            entityId: true,
            vendor: true,
            entityType: true,
            eventType: true,
            title: true,
            url: true,
          },
        }),
    pageIds.length === 0
      ? Promise.resolve([])
      : prisma.insightEntityAlias.groupBy({
          by: ["entityId"],
          where: { entityId: { in: pageIds } },
          _count: { _all: true },
        }),
  ]);
  const latestOf = new Map<bigint, (typeof latest)[number]>();
  for (const e of latest) {
    if (e.entityId !== null && !latestOf.has(e.entityId)) latestOf.set(e.entityId, e);
  }
  const aliasOf = new Map(aliasCounts.map((a) => [a.entityId, a._count._all]));

  const rows: EntityRow[] = pageRows.map(({ meta, count, lastAt }) => {
    const parent = meta.parentId === null ? null : (ancestors.get(meta.parentId) ?? null);
    let root = meta;
    for (let depth = 0; depth < MAX_DEPTH && root.parentId !== null; depth += 1) {
      const up = ancestors.get(root.parentId);
      if (!up) break;
      root = up;
    }
    const l = latestOf.get(meta.id);
    return {
      key: meta.key,
      displayName: meta.displayName,
      entityType: meta.entityType,
      vendorKey: meta.vendorKey,
      parentKey: parent?.key ?? null,
      parentName: parent?.displayName ?? null,
      rootKey: root.key,
      rootName: root.displayName,
      aliasCount: aliasOf.get(meta.id) ?? 0,
      eventCount: count,
      lastAt: lastAt.toISOString(),
      latestEventType: l?.eventType ?? "",
      latestTitle: l?.title ?? meta.displayName,
      latestUrl: l?.url ?? "",
    };
  });

  return {
    sections: groupSections(rows),
    total,
    page: filters.page,
    pages: Math.max(1, Math.ceil(total / ENTITY_PAGE_SIZE)),
    unresolved,
  };
}

/** 页内按顶层品牌分区:分区按最新活跃排序,区内按产品线→活跃度排序 */
function groupSections(rows: EntityRow[]): EntitySection[] {
  const byRoot = new Map<string, EntitySection>();
  for (const row of rows) {
    let section = byRoot.get(row.rootKey);
    if (!section) {
      section = { rootKey: row.rootKey, rootName: row.rootName, eventCount: 0, rows: [] };
      byRoot.set(row.rootKey, section);
    }
    section.rows.push(row);
    section.eventCount += row.eventCount;
  }
  const sections = [...byRoot.values()];
  for (const s of sections) {
    s.rows.sort(
      (a, b) =>
        (a.parentKey ?? "").localeCompare(b.parentKey ?? "") || b.lastAt.localeCompare(a.lastAt),
    );
  }
  // 分区顺序:页内首条(最新活跃)出现的先后
  const order = new Map(rows.map((r, i) => [r.rootKey, i]));
  sections.sort((a, b) => (order.get(a.rootKey) ?? 0) - (order.get(b.rootKey) ?? 0));
  return sections;
}

/** 详情:按规范键/别名/匹配键解析 → 事件时间线 + 别名集合关联信号 + 同族实体 */
export async function getEntityDetail(key: string): Promise<EntityDetail | null> {
  const resolved = await findEntity(key);
  const meta: EntityMeta | null =
    resolved === null
      ? null
      : await prisma.insightEntity.findUnique({ where: { id: resolved.id }, select: META_SELECT });

  // 未建实体的历史键:按 entityKey 直查(回填前/解析降级时的降级读)
  const entityId = meta?.id ?? null;
  if (meta?.status === "merged" && meta.mergedIntoId !== null) {
    const target = await prisma.insightEntity.findUnique({
      where: { id: meta.mergedIntoId },
      select: { key: true },
    });
    return {
      key: meta.key,
      displayName: meta.displayName,
      entityType: meta.entityType,
      vendorKey: meta.vendorKey,
      parent: null,
      root: null,
      aliases: [],
      eventCount: 0,
      vendors: [],
      entityTypes: [],
      events: [],
      signals: [],
      children: [],
      siblings: [],
      redirectTo: target?.key ?? null,
    };
  }

  const eventWhere = entityId === null ? { entityKey: key } : { entityId };
  const [aliases, events, eventCount, facets] = await Promise.all([
    entityId === null
      ? Promise.resolve([])
      : prisma.insightEntityAlias.findMany({
          where: { entityId },
          orderBy: { aliasKey: "asc" },
          select: { aliasKey: true },
        }),
    prisma.entityEvent.findMany({
      where: eventWhere,
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
    prisma.entityEvent.count({ where: eventWhere }),
    prisma.entityEvent.groupBy({
      by: ["vendor", "entityType"],
      where: eventWhere,
      _count: { _all: true },
    }),
  ]);

  const aliasKeys = [
    ...new Set([key, ...(meta ? [meta.key] : []), ...aliases.map((a) => a.aliasKey)]),
  ];
  const signals = await listSignalsByEntityKey(aliasKeys, ENTITY_SIGNAL_TAKE);
  if (eventCount === 0 && signals.length === 0) return null;

  const ancestors = meta === null ? new Map<bigint, EntityMeta>() : await loadAncestors([meta]);
  const parentMeta = meta?.parentId == null ? null : (ancestors.get(meta.parentId) ?? null);
  let rootMeta: EntityMeta | null = meta;
  for (
    let depth = 0;
    rootMeta !== null && rootMeta.parentId !== null && depth < MAX_DEPTH;
    depth += 1
  ) {
    const up = ancestors.get(rootMeta.parentId);
    if (!up) break; // 祖先缺失(清理过脏数据)时停在当前层,不丢根
    rootMeta = up;
  }

  const [children, siblings] = await loadRelated(meta, parentMeta?.id ?? null);

  return {
    key: meta?.key ?? key,
    displayName: meta?.displayName ?? key,
    entityType: meta?.entityType ?? "",
    vendorKey: meta?.vendorKey ?? null,
    parent:
      parentMeta === null ? null : { key: parentMeta.key, displayName: parentMeta.displayName },
    root: rootMeta === null ? null : { key: rootMeta.key, displayName: rootMeta.displayName },
    aliases: aliasKeys,
    eventCount,
    vendors: [...new Set(facets.map((f) => f.vendor))].sort(),
    entityTypes: [...new Set(facets.map((f) => f.entityType))].sort(),
    events: events.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() })),
    signals,
    children,
    siblings,
    redirectTo: null,
  };
}

/** 子实体 + 同父兄弟(带事件数),各限 ENTITY_RELATED_TAKE 条 */
async function loadRelated(
  meta: EntityMeta | null,
  parentId: bigint | null,
): Promise<[EntityLink[], EntityLink[]]> {
  if (meta === null) return [[], []];
  const [kids, sibs] = await Promise.all([
    prisma.insightEntity.findMany({
      where: { parentId: meta.id, status: "active" },
      select: { id: true, key: true, displayName: true },
      take: ENTITY_RELATED_TAKE,
    }),
    parentId === null
      ? Promise.resolve([])
      : prisma.insightEntity.findMany({
          where: { parentId, status: "active", id: { not: meta.id } },
          select: { id: true, key: true, displayName: true },
          take: ENTITY_RELATED_TAKE,
        }),
  ]);
  const ids = [...kids, ...sibs].map((e) => e.id);
  const counts =
    ids.length === 0
      ? []
      : await prisma.entityEvent.groupBy({
          by: ["entityId"],
          where: { entityId: { in: ids } },
          _count: { _all: true },
        });
  const countOf = new Map(counts.map((c) => [c.entityId, c._count._all]));
  const toLink = (e: { id: bigint; key: string; displayName: string }): EntityLink => ({
    key: e.key,
    displayName: e.displayName,
    eventCount: countOf.get(e.id) ?? 0,
  });
  return [kids.map(toLink), sibs.map(toLink)];
}
