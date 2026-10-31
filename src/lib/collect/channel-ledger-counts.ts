/**
 * 渠道台账「最近运行 · N 条」产出计数(2026-10-30 E2E 修):
 * 原实现只数 telegram 表,registry 渠道(vendor/leaderboard/community)的条目
 * 落在 insight_entity_event / insight_leaderboard_snapshot / insight_signal,于是一律显示
 * 「13:29 · 0 条」——采集成功却像没拉到数据。
 * 本文件按类型把渠道映射到各自产出表,统一口径 = 近 24h 新增行数
 * (与文字渠道的 telegram 计数同语义:本日产出)。
 */
import { prisma } from "../db";
import { resolveCommunityDef } from "../insight/community/registry";
import { resolveVendorDef } from "../insight/vendor/registry";
import { resolveLeaderboardDef } from "../leaderboard/registry";

import {
  CRAWL_SOURCE_TYPE_COMMUNITY,
  CRAWL_SOURCE_TYPE_LEADERBOARD,
  CRAWL_SOURCE_TYPE_VENDOR,
} from "./constants";

const DAY_MS = 24 * 3_600_000;
const REGISTRY_TYPES = [
  CRAWL_SOURCE_TYPE_VENDOR,
  CRAWL_SOURCE_TYPE_LEADERBOARD,
  CRAWL_SOURCE_TYPE_COMMUNITY,
];

/** registry 渠道 → 产出表 source 键(null = 未注册/配置漂移) */
export function registrySourceKey(source: { type: string; config: unknown }): string | null {
  if (source.type === CRAWL_SOURCE_TYPE_VENDOR) {
    return resolveVendorDef(source.config)?.insightSource ?? null;
  }
  if (source.type === CRAWL_SOURCE_TYPE_LEADERBOARD) {
    return resolveLeaderboardDef(source.config)?.key ?? null;
  }
  if (source.type === CRAWL_SOURCE_TYPE_COMMUNITY) {
    return resolveCommunityDef(source.config)?.insightSource ?? null;
  }
  return null;
}

/** 按渠道 id 的近 24h 产出计数(产出表 source 列 = vendor-openai / <boardKey> / community-hn) */
export async function registryOutputCountByChannel(): Promise<Map<number, number>> {
  const since = new Date(Date.now() - DAY_MS);
  const [sources, vendors, boards, community] = await Promise.all([
    prisma.crawlSource.findMany({
      where: { type: { in: REGISTRY_TYPES } },
      select: { id: true, type: true, config: true },
    }),
    prisma.insightEntityEvent.groupBy({
      by: ["source"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.insightLeaderboardSnapshot.groupBy({
      by: ["source"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.insightSignal.groupBy({
      by: ["source"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);
  const counts = new Map<string, number>();
  for (const g of [...vendors, ...boards, ...community]) counts.set(g.source, g._count._all);
  const byChannel = new Map<number, number>();
  for (const s of sources) {
    const key = registrySourceKey(s);
    if (key !== null) byChannel.set(s.id, counts.get(key) ?? 0);
  }
  return byChannel;
}

/** 单渠道产出数:registry 类型查产出表映射(缺键回退 telegram 计数,通常为 0);
 * 文字渠道沿用 telegram count24h */
export function outputCountOf(
  source: { id: number; type: string; count24h: number },
  byChannel: Map<number, number>,
): number {
  return byChannel.get(source.id) ?? source.count24h;
}

/** 该渠道是否落取数快照(三类 registry 渠道均经 SourceCapture;文字/GitHub 无) */
export function hasSnapshots(type: string): boolean {
  return REGISTRY_TYPES.includes(type);
}
