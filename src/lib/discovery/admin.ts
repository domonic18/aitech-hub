/**
 * 发现治理台业务库(M25 批③):词库/候选双列表(分段+分页+状态计数)、
 * 人工加词(origin=manual 直接生效——人工添加即明确意图)、手动触发两发现
 * 任务。页面(RSC)与 /api/discovery 组路由同用此层;数据唯一真相源在
 * 本系统,外部分发后续经 MCP 由 Claude Code 打通。
 */
import { logger } from "../logger";
import { prisma } from "../db";
import { DISCOVERY_JOB_BILI, DISCOVERY_JOB_HOTWORDS, QUEUE_DISCOVERY, getQueue } from "../queue";

import { normalizeWord } from "./keywords";
import type { CandidateListSegment, KeywordListSegment } from "./status";
import { DISCOVERY_PAGE_SIZE } from "./status";

function jsonStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// ── 词库列表 ─────────────────────────────────────────────

export interface KeywordAdminRow {
  id: string;
  word: string;
  origin: string;
  status: string;
  source: string | null;
  firstSeenAt: Date;
  confirmedAt: Date | null;
}

export interface KeywordListResult {
  items: KeywordAdminRow[];
  total: number;
  counts: Record<KeywordListSegment, number>;
}

export async function listKeywordsAdmin(params: {
  segment: KeywordListSegment;
  page: number;
  /** 词模糊搜索(F23 板筛选;归一形小写,入参归一后 contains) */
  kw?: string;
  /** 来源过滤:manual(手动)| hotword(发现任务联想) */
  origin?: string;
}): Promise<KeywordListResult> {
  const where = {
    ...(params.segment === "all" ? {} : { status: params.segment }),
    ...(params.kw ? { word: { contains: params.kw.toLowerCase() } } : {}),
    ...(params.origin ? { origin: params.origin } : {}),
  };
  const [rows, total, grouped] = await Promise.all([
    prisma.discoveryKeyword.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * DISCOVERY_PAGE_SIZE,
      take: DISCOVERY_PAGE_SIZE,
    }),
    prisma.discoveryKeyword.count({ where }),
    prisma.discoveryKeyword.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const byStatus = new Map(grouped.map((g) => [g.status, g._count._all]));
  return {
    items: rows.map((r) => ({
      id: r.id.toString(),
      word: r.word,
      origin: r.origin,
      status: r.status,
      source: r.source,
      firstSeenAt: r.firstSeenAt,
      confirmedAt: r.confirmedAt,
    })),
    total,
    counts: {
      all: [...byStatus.values()].reduce((a, b) => a + b, 0),
      pending: byStatus.get("pending") ?? 0,
      active: byStatus.get("active") ?? 0,
      dismissed: byStatus.get("dismissed") ?? 0,
    },
  };
}

export interface ManualKeywordResult {
  id: bigint;
  word: string;
  created: boolean;
  /** 已存在时的当前状态(409 消息用;新建为 null) */
  existingStatus: string | null;
}

/** 人工加词:归一 trim+lower,origin=manual status=active 并记 confirmedAt。
 *  词已存在不覆盖不复活(状态归属治理台流转),返回现有行由路由决定口径。 */
export async function addManualKeyword(rawWord: string): Promise<ManualKeywordResult> {
  const word = normalizeWord(rawWord);
  const existing = await prisma.discoveryKeyword.findUnique({ where: { word } });
  if (existing) {
    return {
      id: existing.id,
      word: existing.word,
      created: false,
      existingStatus: existing.status,
    };
  }
  const row = await prisma.discoveryKeyword.create({
    data: { word, origin: "manual", status: "active", confirmedAt: new Date() },
  });
  return { id: row.id, word: row.word, created: true, existingStatus: null };
}

// ── 候选列表 ─────────────────────────────────────────────

export interface CandidateAdminRow {
  id: string;
  type: string;
  platform: string;
  externalId: string;
  round: string;
  title: string | null;
  author: string | null;
  homepageUrl: string | null;
  hitKeywords: string[];
  hitCount: number | null;
  maxPlay: number | null;
  totalPlay: number | null;
  fans: number | null;
  archives: number | null;
  sampleTitles: string[];
  l0Verdict: string;
  l0Reason: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CandidateListResult {
  items: CandidateAdminRow[];
  total: number;
  counts: Record<CandidateListSegment, number>;
}

export async function listCandidatesAdmin(params: {
  segment: CandidateListSegment;
  page: number;
  /** 按命中词过滤(词库效能云点词跳入;jsonb 数组 containment) */
  kw?: string;
}): Promise<CandidateListResult> {
  const where = {
    ...(params.segment === "all" ? {} : { status: params.segment }),
    ...(params.kw ? { hitKeywords: { array_contains: params.kw } } : {}),
  };
  const [rows, total, grouped] = await Promise.all([
    prisma.discoveryCandidate.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * DISCOVERY_PAGE_SIZE,
      take: DISCOVERY_PAGE_SIZE,
    }),
    prisma.discoveryCandidate.count({ where }),
    prisma.discoveryCandidate.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const byStatus = new Map(grouped.map((g) => [g.status, g._count._all]));
  return {
    items: rows.map((r) => ({
      id: r.id.toString(),
      type: r.type,
      platform: r.platform,
      externalId: r.externalId,
      round: r.round,
      title: r.title,
      author: r.author,
      homepageUrl: r.homepageUrl,
      hitKeywords: jsonStringArray(r.hitKeywords),
      hitCount: r.hitCount,
      maxPlay: r.maxPlay,
      totalPlay: r.totalPlay,
      fans: r.fans,
      archives: r.archives,
      sampleTitles: jsonStringArray(r.sampleTitles),
      l0Verdict: r.l0Verdict,
      l0Reason: r.l0Reason,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    total,
    counts: {
      all: [...byStatus.values()].reduce((a, b) => a + b, 0),
      pending: byStatus.get("pending") ?? 0,
      approved: byStatus.get("approved") ?? 0,
      rejected: byStatus.get("rejected") ?? 0,
    },
  };
}

// ── 手动触发 ─────────────────────────────────────────────

export type DiscoveryTriggerJob = "hotwords" | "bili";

/** 手动触发一轮发现:入 discovery 队列一次性 job,jobId 带 manual 前缀与
 *  调度 job(id 锚定 next_run_at)不冲突;入队即返回,执行与风控纪律在 worker。 */
export async function triggerDiscovery(job: DiscoveryTriggerJob): Promise<{ enqueued: true }> {
  const name = job === "hotwords" ? DISCOVERY_JOB_HOTWORDS : DISCOVERY_JOB_BILI;
  await getQueue(QUEUE_DISCOVERY).add(
    name,
    {},
    {
      jobId: `${name}-manual-${Date.now()}`,
      removeOnComplete: 200,
      removeOnFail: 200,
    },
  );
  logger.info({ event: "discovery.triggered", job });
  return { enqueued: true };
}
