/**
 * 榜单快照 → 实体解析(M64,data-expansion-plan §16):榜单 `entityKey` 是各源原始写法
 * (AA slug 如 `gpt-6-1-terra`;HF 模型 id 如 `Qwen/Qwen3-8B`),与事件层经
 * `resolveEntity` 归一后的键不同源。本模块是两者之间的唯一出口。
 *
 * 三条口径:
 * 1. **只读**:命中即返回,未命中返回 null——写入路径不建实体(否则上游榜单里
 *    大量非模型条目会污染实体表);未命中由采集侧记诊断日志,不阻塞采集。
 * 2. **不做别名写入**:解析纯读,别名表只由事件抽取链与人工归并维护。
 * 3. **HF 末段回退**:实体层没有 org 段(`vendor_key` 另行承载),`qwen/qwen3-8b`
 *    在主键/别名均未命中时退到末段 `qwen3-8b` 再解析一次;只退一级。
 *
 * 合并跟随:命中行 status=merged 时沿 `merged_into_id` 追到 active 目标(限深 8),
 * 落库的是目标实体——否则归并后的榜单表现还挂在幽灵实体上。
 *
 * 批量预载:单榜 ≤60 条,别名与匹配键各一次 `findMany`,不逐条查库。
 */
import { prisma } from "@/lib/db";

import { canonicalKey, matchKeyOf } from "./resolve";

/** 参与实体化的榜单源(采集 `source` 口径 = registry 的 boardKey) */
const ENTITY_LINKED_SOURCES: ReadonlySet<string> = new Set(["artificial-analysis", "huggingface"]);

/** 合并跟随最大深度(与实体树 MAX_DEPTH 同量级;防脏数据成环) */
const MERGE_DEPTH = 8;

export interface LeaderboardEntityRef {
  id: bigint;
  /** 实体规范键(详情页锚) */
  key: string;
}

interface EntityRow {
  id: bigint;
  key: string;
  matchKey: string;
  status: string;
  mergedIntoId: bigint | null;
}

export function isEntityLinkedSource(source: string): boolean {
  return ENTITY_LINKED_SOURCES.has(source);
}

/** 单键候选:规范键(+ HF 模型 id 的末段;`org/model` 才退段) */
function candidateKeys(rawKey: string): string[] {
  const canonical = canonicalKey(rawKey);
  if (canonical === "") return [];
  const cut = canonical.lastIndexOf("/");
  if (cut <= 0 || cut === canonical.length - 1) return [canonical];
  return [canonical, canonical.slice(cut + 1)];
}

/** 沿 merged_into_id 追到 active 目标;链断/成环返回 null */
async function followMerged(seed: EntityRow[]): Promise<Map<bigint, EntityRow>> {
  const known = new Map<bigint, EntityRow>(seed.map((r) => [r.id, r]));
  let pending = seed.filter((r) => r.status === "merged" && r.mergedIntoId !== null);
  for (let depth = 0; depth < MERGE_DEPTH && pending.length > 0; depth += 1) {
    const want = [
      ...new Set(
        pending
          .map((r) => r.mergedIntoId)
          .filter((id): id is bigint => id !== null && !known.has(id)),
      ),
    ];
    if (want.length === 0) break;
    const rows: EntityRow[] = await prisma.insightEntity.findMany({
      where: { id: { in: want } },
      select: { id: true, key: true, matchKey: true, status: true, mergedIntoId: true },
    });
    for (const r of rows) known.set(r.id, r);
    pending = rows.filter((r) => r.status === "merged" && r.mergedIntoId !== null);
  }
  return known;
}

/** 命中行 → active 目标;多级归并逐跳跟随,链断/成环时返回 null(宁缺不挂错) */
function activeRef(
  row: EntityRow | undefined,
  known: Map<bigint, EntityRow>,
): LeaderboardEntityRef | null {
  let cur = row;
  for (let depth = 0; cur !== undefined && cur.status === "merged"; depth += 1) {
    if (cur.mergedIntoId === null || depth >= MERGE_DEPTH) return null;
    cur = known.get(cur.mergedIntoId);
  }
  if (cur === undefined || cur.status !== "active") return null;
  return { id: cur.id, key: cur.key };
}

/**
 * 批量解析(采集写入路径):rawKey 原样 → 实体;不参与实体化的源与未命中一律 null。
 * 别名优先于匹配键(别名是显式登记的历史写法),每个候选按「规范键 → 末段」顺序。
 */
export async function resolveLeaderboardEntities(
  source: string,
  rawKeys: readonly string[],
): Promise<Map<string, LeaderboardEntityRef | null>> {
  const result = new Map<string, LeaderboardEntityRef | null>();
  if (!isEntityLinkedSource(source)) {
    for (const raw of rawKeys) result.set(raw, null);
    return result;
  }
  const candidatesOf = new Map<string, string[]>();
  const aliasKeys = new Set<string>();
  const matchKeys = new Set<string>();
  for (const raw of rawKeys) {
    const keys = candidateKeys(raw);
    candidatesOf.set(raw, keys);
    for (const k of keys) {
      aliasKeys.add(k);
      matchKeys.add(matchKeyOf(k));
    }
  }
  if (aliasKeys.size === 0) {
    for (const raw of rawKeys) result.set(raw, null);
    return result;
  }

  const [aliases, byMatch] = await Promise.all([
    prisma.insightEntityAlias.findMany({
      where: { aliasKey: { in: [...aliasKeys] } },
      select: {
        aliasKey: true,
        entity: {
          select: { id: true, key: true, matchKey: true, status: true, mergedIntoId: true },
        },
      },
    }),
    prisma.insightEntity.findMany({
      where: { matchKey: { in: [...matchKeys] } },
      select: { id: true, key: true, matchKey: true, status: true, mergedIntoId: true },
    }),
  ]);

  const aliasOf = new Map<string, EntityRow>(aliases.map((a) => [a.aliasKey, a.entity]));
  const matchOf = new Map<string, EntityRow>(byMatch.map((r) => [r.matchKey, r]));
  const known = await followMerged([...aliasOf.values(), ...byMatch]);

  for (const raw of rawKeys) {
    const keys = candidatesOf.get(raw) ?? [];
    const hit = keys.reduce<EntityRow | undefined>(
      (found, k) => found ?? aliasOf.get(k) ?? matchOf.get(matchKeyOf(k)),
      undefined,
    );
    result.set(raw, activeRef(hit, known));
  }
  return result;
}

/** 单键解析(回填脚本 / 后台诊断用;批量路径勿循环调用) */
export async function resolveLeaderboardEntity(
  rawKey: string,
  source: string,
): Promise<LeaderboardEntityRef | null> {
  const map = await resolveLeaderboardEntities(source, [rawKey]);
  return map.get(rawKey) ?? null;
}
