/**
 * 牌价页外部榜单引用(P5):把 pricing 模型与 insight 榜单实体挂接,
 * 显示 AA / HuggingFace 等外部榜单的最新名次。
 *
 * 只读、只引名次与外链,不镜像榜单图片/数据。
 */
import { prisma } from "@/lib/db";
import { resolveLeaderboardEntities } from "@/lib/insight/entities/leaderboard";
import type { PublicModelRow } from "./public";

export interface LeaderboardBadge {
  source: string;
  board: string;
  rank: number;
  /** 与上一可用日期的名次差(正=上升,负=下降,null=无历史) */
  delta: number | null;
  score: number | null;
  scoreUnit: string | null;
  capturedDate: string;
  /** 榜单详情页外链(来自 snapshot.meta.url) */
  url: string | null;
}

const SOURCES = ["artificial-analysis", "huggingface"] as const;

/** 从 pricing 行提取可能命中实体的候选键 */
function candidateKeys(
  row: Pick<PublicModelRow, "modelKey" | "modelDictKey" | "modelGroupKey">,
): string[] {
  const keys: string[] = [];
  if (row.modelGroupKey) keys.push(row.modelGroupKey);
  if (row.modelDictKey) keys.push(row.modelDictKey);
  keys.push(row.modelKey);
  return [...new Set(keys)];
}

/**
 * 批量加载每行的榜单角标。
 * 返回 Map 键 = `row.modelDictKey ?? row.modelKey`(与 compare.ts 归一键一致),
 * 值 = 该模型的榜单徽章列表(可能为空)。
 */
export async function loadPricingLeaderboardPresence(
  rows: Pick<PublicModelRow, "modelKey" | "modelDictKey" | "modelGroupKey">[],
): Promise<Map<string, LeaderboardBadge[]>> {
  const rowKeys = rows.map((r) => r.modelDictKey ?? r.modelKey);
  const allCandidates = new Set<string>();
  for (const r of rows) {
    for (const k of candidateKeys(r)) allCandidates.add(k);
  }
  const candidateList = [...allCandidates];
  if (candidateList.length === 0) return new Map();

  const [aaMap, hfMap] = await Promise.all([
    resolveLeaderboardEntities(SOURCES[0], candidateList),
    resolveLeaderboardEntities(SOURCES[1], candidateList),
  ]);

  // 合并两个源:键 → 实体 ref(取首个非 null)
  const entityByKey = new Map<string, { id: bigint; key: string }>();
  for (const [, map] of [[SOURCES[0], aaMap] as const, [SOURCES[1], hfMap] as const]) {
    for (const [rawKey, ref] of map) {
      if (ref === null) continue;
      if (!entityByKey.has(rawKey)) entityByKey.set(rawKey, ref);
    }
  }

  const entityIds = [
    ...new Set(
      [...entityByKey.values()].map((e) => e.id).filter((id): id is bigint => id !== null),
    ),
  ];
  if (entityIds.length === 0) return new Map();

  const snapshots = await prisma.insightLeaderboardSnapshot.findMany({
    where: { entityId: { in: entityIds } },
    orderBy: [{ capturedDate: "desc" }],
    select: {
      source: true,
      board: true,
      rank: true,
      score: true,
      scoreUnit: true,
      capturedDate: true,
      meta: true,
      entityId: true,
    },
  });

  // 每个 entity × source 取最新 + 前一可用日期的 rank 算 delta
  const badgesByEntity = new Map<bigint, LeaderboardBadge[]>();
  for (const s of snapshots) {
    if (s.entityId === null) continue;
    const list = badgesByEntity.get(s.entityId) ?? [];
    const existing = list.find((b) => b.source === s.source);
    if (existing === undefined) {
      list.push({
        source: s.source,
        board: s.board,
        rank: s.rank,
        delta: null,
        score: s.score,
        scoreUnit: s.scoreUnit,
        capturedDate: s.capturedDate.toISOString().slice(0, 10),
        url: (s.meta as { url?: string } | null)?.url ?? null,
      });
    } else if (existing.delta === null) {
      existing.delta = s.rank - existing.rank;
    }
    badgesByEntity.set(s.entityId, list);
  }

  const out = new Map<string, LeaderboardBadge[]>();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const key = rowKeys[i] as string;
    const badges: LeaderboardBadge[] = [];
    const seenSources = new Set<string>();
    for (const k of candidateKeys(row)) {
      const ref = entityByKey.get(k);
      if (ref === undefined) continue;
      for (const b of badgesByEntity.get(ref.id) ?? []) {
        if (seenSources.has(b.source)) continue;
        seenSources.add(b.source);
        badges.push(b);
      }
    }
    if (badges.length > 0) out.set(key, badges);
  }
  return out;
}

/** 单条便捷函数(测试/诊断用) */
export async function findPricingLeaderboardBadges(
  row: Pick<PublicModelRow, "modelKey" | "modelDictKey" | "modelGroupKey">,
): Promise<LeaderboardBadge[]> {
  const map = await loadPricingLeaderboardPresence([row]);
  return map.get(row.modelDictKey ?? row.modelKey) ?? [];
}
