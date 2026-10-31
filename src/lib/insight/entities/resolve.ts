/**
 * 实体解析(M60):LLM 抽取键 → 规范实体(org 品牌 / line 产品线 / model·product)。
 *
 * 对标 Wikidata「实体 + 别名」与 Crunchbase「厂商 → 产品」层级,三条不变量:
 * 1. 别名表保留每个历史写法,`insight_entity_event.entityKey` 永不改写(dedupeKey 稳定);
 * 2. matchKey 折叠 `.`/`_`/重复连字符,`gpt-6.1-terra` 与 `gpt-6-1-terra` 归同一实体;
 * 3. 父级按「同厂商下 `-` 边界最长前缀」挂产品线(`qwen3-embedding` → `qwen3`),
 *    无前缀命中挂厂商 org(`qwen`)——列表即按品牌/产品线折叠。
 *
 * 并发口径:别名 upsert + 建实体唯一冲突回读,多 worker 同键并发不会抛穿。
 */
import { prisma } from "@/lib/db";
import { normalizeEntityKey } from "@/lib/insight/vendor/contract";
import { VENDOR_DEFS } from "@/lib/insight/vendor/registry";

export interface ResolveInput {
  /** 厂商 key(注册表口径);社区/新闻源暂无,传 null */
  vendorKey: string | null;
  /** LLM 抽取的原始实体键 */
  rawKey: string;
  /** model | product | org */
  entityType: string;
}

export interface ResolvedEntity {
  id: bigint;
  key: string;
}

const VENDOR_NAMES: Record<string, string> = Object.fromEntries(
  VENDOR_DEFS.map((d) => [d.key, d.vendorName]),
);

/** 规范键(展示/URL 用):normalizeEntityKey 之上保留 `/` 分段 */
export function canonicalKey(raw: string): string {
  return normalizeEntityKey(raw)
    .split("/")
    .map((seg) => seg.replace(/^-+|-+$/g, ""))
    .filter((seg) => seg !== "")
    .join("/");
}

/** 匹配键(去重锚):分隔符归一 —— `.`/`_`/重复 `-` 全折叠成单 `-` */
export function matchKeyOf(raw: string): string {
  return canonicalKey(raw)
    .split("/")
    .map((seg) =>
      seg
        .replace(/[._]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter((seg) => seg !== "")
    .join("/");
}

/** 父级候选:同厂商既有键里 `-` 边界最长前缀(`qwen3` 之于 `qwen3-embedding`) */
export function pickParentKey(key: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  for (const c of candidates) {
    if (c === key || !key.startsWith(`${c}-`)) continue;
    if (best === null || c.length > best.length) best = c;
  }
  return best;
}

/** 厂商展示名(org 实体);未注册厂商回退 key 本身 */
export function vendorDisplayName(vendorKey: string): string {
  return VENDOR_NAMES[vendorKey] ?? vendorKey;
}

async function addAlias(entityId: bigint, aliasKey: string, origin: string): Promise<void> {
  await prisma.insightEntityAlias.upsert({
    where: { aliasKey },
    update: {},
    create: { aliasKey, entityId, origin },
  });
}

/** 取或建厂商 org 实体(`qwen` → Qwen) */
async function getOrCreateOrg(vendorKey: string): Promise<ResolvedEntity> {
  const key = canonicalKey(vendorKey);
  const mk = matchKeyOf(vendorKey);
  const found = await prisma.insightEntity.findUnique({
    where: { matchKey: mk },
    select: { id: true, key: true },
  });
  if (found) return found;
  try {
    const created = await prisma.insightEntity.create({
      data: {
        key,
        matchKey: mk,
        displayName: vendorDisplayName(vendorKey),
        entityType: "org",
        vendorKey,
      },
      select: { id: true, key: true },
    });
    await addAlias(created.id, key, "rule");
    return created;
  } catch {
    // 并发建同键:唯一冲突回读
    const raced = await prisma.insightEntity.findUnique({
      where: { matchKey: mk },
      select: { id: true, key: true },
    });
    if (raced) return raced;
    throw new Error(`entity org create failed: ${vendorKey}`);
  }
}

/** 定父级:同厂商前缀产品线优先,其次厂商 org;厂商未知则不挂父 */
async function resolveParentId(
  vendorKey: string | null,
  key: string,
  entityType: string,
): Promise<bigint | null> {
  if (vendorKey === null || entityType === "org") return null;
  const siblings = await prisma.insightEntity.findMany({
    where: { vendorKey, status: "active", entityType: { not: "org" } },
    select: { key: true },
  });
  const parentKey = pickParentKey(
    key,
    siblings.map((s) => s.key),
  );
  if (parentKey !== null) {
    const parent = await prisma.insightEntity.findUnique({
      where: { key: parentKey },
      select: { id: true },
    });
    if (parent) return parent.id;
  }
  const org = await getOrCreateOrg(vendorKey);
  return org.id;
}

/**
 * 解析并落库(写入路径唯一出口):别名命中 → 匹配键命中 → 新建(定父级)。
 * 失败向上抛,调用侧负责降级(事件照常入库,entityId 留空)。
 */
export async function resolveEntity(input: ResolveInput): Promise<ResolvedEntity | null> {
  const key = canonicalKey(input.rawKey);
  if (key === "") return null;
  const mk = matchKeyOf(key);

  const alias = await prisma.insightEntityAlias.findUnique({
    where: { aliasKey: key },
    select: { entity: { select: { id: true, key: true } } },
  });
  if (alias) return alias.entity;

  const existing = await prisma.insightEntity.findUnique({
    where: { matchKey: mk },
    select: { id: true, key: true },
  });
  if (existing) {
    await addAlias(existing.id, key, "rule");
    return existing;
  }

  const parentId = await resolveParentId(input.vendorKey, key, input.entityType);
  try {
    const created = await prisma.insightEntity.create({
      data: {
        key,
        matchKey: mk,
        displayName: key,
        entityType: input.entityType,
        vendorKey: input.vendorKey,
        parentId,
      },
      select: { id: true, key: true },
    });
    await addAlias(created.id, key, "rule");
    return created;
  } catch {
    const raced = await prisma.insightEntity.findUnique({
      where: { matchKey: mk },
      select: { id: true, key: true },
    });
    if (raced) {
      await addAlias(raced.id, key, "rule");
      return raced;
    }
    throw new Error(`entity create failed: ${key}`);
  }
}

/** 按规范键 / 别名 / 匹配键解析实体(详情页入口;未命中返回 null) */
export async function findEntity(key: string): Promise<ResolvedEntity | null> {
  const canonical = canonicalKey(key);
  if (canonical === "") return null;
  const direct = await prisma.insightEntity.findUnique({
    where: { key: canonical },
    select: { id: true, key: true },
  });
  if (direct) return direct;
  const alias = await prisma.insightEntityAlias.findUnique({
    where: { aliasKey: canonical },
    select: { entity: { select: { id: true, key: true } } },
  });
  if (alias) return alias.entity;
  // 分隔符变体路径(gpt-6-1-terra 之于 gpt-6.1-terra)仍可解析,不 404
  return prisma.insightEntity.findUnique({
    where: { matchKey: matchKeyOf(canonical) },
    select: { id: true, key: true },
  });
}

export interface MergeOutcome {
  movedAliases: number;
  movedEvents: number;
  movedChildren: number;
}

/**
 * 人工归并:把 from 的别名/事件/子实体迁到 to,from 置 merged 留痕。
 * 拒绝自并、拒绝「to 是 from 的子孙」(成环)。
 */
export async function mergeEntities(
  fromKey: string,
  toKey: string,
): Promise<MergeOutcome | "not_found" | "cycle"> {
  const from = await findEntity(fromKey);
  const to = await findEntity(toKey);
  if (!from || !to) return "not_found";
  if (from.id === to.id) return "not_found";

  // 成环检查:自 to 向上走,遇 from 即拒绝
  let cursor: bigint | null = to.id;
  for (let depth = 0; depth < 16 && cursor !== null; depth += 1) {
    const row: { parentId: bigint | null } | null = await prisma.insightEntity.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    if (!row) break;
    if (row.parentId === from.id) return "cycle";
    cursor = row.parentId;
  }

  const [aliases, events, children] = await prisma.$transaction([
    prisma.insightEntityAlias.updateMany({
      where: { entityId: from.id },
      data: { entityId: to.id, origin: "manual" },
    }),
    prisma.insightEntityEvent.updateMany({
      where: { entityId: from.id },
      data: { entityId: to.id },
    }),
    prisma.insightEntity.updateMany({
      where: { parentId: from.id },
      data: { parentId: to.id },
    }),
  ]);
  await prisma.insightEntity.update({
    where: { id: from.id },
    data: { status: "merged", mergedIntoId: to.id },
  });
  return {
    movedAliases: aliases.count,
    movedEvents: events.count,
    movedChildren: children.count,
  };
}
