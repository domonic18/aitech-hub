/**
 * discovery_candidate 仓储(M25 任务B):身份幂等落库((type,platform,externalId)
 * 唯一)与人工终审状态流转(批③治理台同用)。
 * 幂等语义:重复发现刷新指标与 round,不动人工终审结论。
 * 数据唯一真相源在本系统;外部分发经 MCP 由 Claude Code 打通,系统内不耦合。
 */
import type { DiscoveryCandidate } from "@prisma/client";

import { prisma } from "../db";

export type CandidateType = "blogger" | "video";
export type CandidateReviewStatus = "pending" | "approved" | "rejected";

export interface CandidateInput {
  type: CandidateType;
  externalId: string;
  title?: string | null;
  author?: string | null;
  homepageUrl?: string | null;
  hitKeywords: string[];
  hitCount: number;
  maxPlay?: number | null;
  totalPlay?: number | null;
  fans?: number | null;
  archives?: number | null;
  sampleTitles?: string[];
  l0Verdict: "pass" | "reject";
  l0Reason?: string | null;
}

/** 落库结果:created=本轮新落库(轮次统计口径) */
export interface SavedCandidate {
  id: bigint;
  created: boolean;
  input: CandidateInput;
}

function identityKey(type: string, platform: string, externalId: string): string {
  return `${type}:${platform}:${externalId}`;
}

/**
 * 幂等落库:新身份插入(pending);已存在 pending 刷新指标与轮次;
 * approved/rejected 完全不动(人工终审结论不回退,updatedAt 亦不碰——
 * updatedAt 语义=机器刷新时刻,人工操作时间由批③审计路径各表自证)。
 */
export async function saveCandidates(
  inputs: readonly CandidateInput[],
  platform: string,
  round: string,
): Promise<SavedCandidate[]> {
  if (inputs.length === 0) return [];
  const rows = inputs.map((input) => ({
    input,
    type: input.type,
    platform,
    externalId: input.externalId,
    round,
    title: input.title ?? null,
    author: input.author ?? null,
    homepageUrl: input.homepageUrl ?? null,
    hitKeywords: input.hitKeywords,
    hitCount: input.hitCount,
    maxPlay: input.maxPlay ?? null,
    totalPlay: input.totalPlay ?? null,
    fans: input.fans ?? null,
    archives: input.archives ?? null,
    sampleTitles: input.sampleTitles ?? [],
    l0Verdict: input.l0Verdict,
    l0Reason: input.l0Reason ?? null,
  }));

  const identityFilter = rows.map((r) => ({
    type: r.type,
    platform: r.platform,
    externalId: r.externalId,
  }));
  const existing = await prisma.discoveryCandidate.findMany({
    where: { OR: identityFilter },
    select: { id: true, type: true, platform: true, externalId: true, status: true },
  });
  const existingByKey = new Map(
    existing.map((e) => [identityKey(e.type, e.platform, e.externalId), e]),
  );

  // pending 刷新(approved/rejected 跳过)
  for (const r of rows) {
    const prev = existingByKey.get(identityKey(r.type, r.platform, r.externalId));
    if (prev?.status !== "pending") continue;
    await prisma.discoveryCandidate.update({
      where: { id: prev.id },
      data: {
        round: r.round,
        title: r.title,
        author: r.author,
        homepageUrl: r.homepageUrl,
        hitKeywords: r.hitKeywords,
        hitCount: r.hitCount,
        maxPlay: r.maxPlay,
        totalPlay: r.totalPlay,
        fans: r.fans,
        archives: r.archives,
        sampleTitles: r.sampleTitles,
        l0Verdict: r.l0Verdict,
        l0Reason: r.l0Reason,
      },
    });
  }

  // 新身份批量插入(skipDuplicates 兜底)
  const dbFields = (r: (typeof rows)[number]) => ({
    type: r.type,
    platform: r.platform,
    externalId: r.externalId,
    round: r.round,
    title: r.title,
    author: r.author,
    homepageUrl: r.homepageUrl,
    hitKeywords: r.hitKeywords,
    hitCount: r.hitCount,
    maxPlay: r.maxPlay,
    totalPlay: r.totalPlay,
    fans: r.fans,
    archives: r.archives,
    sampleTitles: r.sampleTitles,
    l0Verdict: r.l0Verdict,
    l0Reason: r.l0Reason,
  });
  const newData = rows
    .filter((r) => !existingByKey.has(identityKey(r.type, r.platform, r.externalId)))
    .map(dbFields);
  if (newData.length > 0) {
    await prisma.discoveryCandidate.createMany({ data: newData, skipDuplicates: true });
  }

  // 回查拿 id(新插行 createMany 不返回 id)
  const after = await prisma.discoveryCandidate.findMany({
    where: { OR: identityFilter },
    select: { id: true, type: true, platform: true, externalId: true },
  });
  const idByKey = new Map(after.map((e) => [identityKey(e.type, e.platform, e.externalId), e.id]));

  const saved: SavedCandidate[] = [];
  for (const r of rows) {
    const id = idByKey.get(identityKey(r.type, r.platform, r.externalId));
    if (id === undefined) continue;
    saved.push({
      id,
      created: !existingByKey.has(identityKey(r.type, r.platform, r.externalId)),
      input: r.input,
    });
  }
  return saved;
}

/** 人工终审(治理台批③):approved/rejected;pending 供回退重审 */
export async function setCandidateStatus(
  id: bigint,
  status: CandidateReviewStatus,
): Promise<DiscoveryCandidate> {
  return prisma.discoveryCandidate.update({ where: { id }, data: { status } });
}
