/**
 * discovery_keyword 仓储(M25 任务A):词归一、active 词轮转取用、联想词回灌、
 * 状态流转(批③治理台同用)。归一形 trim+lower(方案 §3),落库即归一,
 * word 唯一约束兜底防重。
 */
import type { DiscoveryKeyword } from "@prisma/client";

import { prisma } from "../db";

/** 词归一形唯一出口:trim + lower(词库比对与回灌同规) */
export function normalizeWord(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 词长上界(VarChar(100);超长联想词直接丢弃) */
export const WORD_MAX_LEN = 100;

/** LRU 轮转取用:updatedAt 最久未用优先,单轮上限 cap(防 active 词增长拖长 job) */
export async function takeActiveWords(cap: number): Promise<DiscoveryKeyword[]> {
  return prisma.discoveryKeyword.findMany({
    where: { status: "active" },
    orderBy: { updatedAt: "asc" },
    take: cap,
  });
}

/** 轮次收尾 touch(作 LRU「最近使用」锚,词被均匀轮转) */
export async function touchWords(ids: bigint[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.discoveryKeyword.updateMany({
    where: { id: { in: ids } },
    data: { updatedAt: new Date() },
  });
}

/** 批量查已存在词(回灌前比对;集合语义) */
export async function findExistingWords(words: string[]): Promise<Set<string>> {
  if (words.length === 0) return new Set();
  const rows = await prisma.discoveryKeyword.findMany({
    where: { word: { in: words } },
    select: { word: true },
  });
  return new Set(rows.map((r) => r.word));
}

export interface HotwordInsertSummary {
  total: number;
  inserted: number;
}

/** 联想词回灌:新词 origin=hotword status=pending 落库(source 记首见源)。
 *  已存在词(含 manual/dismissed)不复活不覆盖——createMany skipDuplicates
 *  语义即所需:人工淘汰过的词不会被联想词重新灌回。 */
export async function insertHotwords(
  words: string[],
  sourceByWord: Map<string, string>,
): Promise<HotwordInsertSummary> {
  if (words.length === 0) return { total: 0, inserted: 0 };
  const res = await prisma.discoveryKeyword.createMany({
    data: words.map((word) => ({
      word,
      origin: "hotword",
      status: "pending",
      source: sourceByWord.get(word) ?? null,
    })),
    skipDuplicates: true,
  });
  return { total: words.length, inserted: res.count };
}

/** 词状态流转(治理台批③):确认转 active(记 confirmedAt);pending 回退清之 */
export async function setKeywordStatus(
  id: bigint,
  status: "active" | "dismissed" | "pending",
): Promise<DiscoveryKeyword> {
  return prisma.discoveryKeyword.update({
    where: { id },
    data: { status, confirmedAt: status === "active" ? new Date() : null },
  });
}
