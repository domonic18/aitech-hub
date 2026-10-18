/**
 * 洞察日批(M34 批②,方案 §5.4-§5.6 + §8):LLM 打标(簇命名/概括/关键词,
 * role=insight 走 AiTaskBinding 治理)+ 内容覆盖度(痛点簇质心 × post 向量
 * 近邻)+ 机会评分与每日快照 + fading 兜底流转。取向:
 * - LLM 只做可读化(命名/概括);介质=成员并集(确定性,方案 §5.4 介质判定
 *   留批③ 多介质外部源接入再收),评分卡为可解释公式而非模型黑盒;
 * - 打标只对「成员数达标且较上次打标有新增」的簇(增量省调用,方案预估
 *   10-30 次/日,配额超限自动截批);未绑定 insight 模型 = 打标跳过,
 *   机械段(评分/快照/覆盖/fading)照跑;
 * - 单簇失败自吞不殃及批内其余,下轮重扫自愈(embed-reconcile 同取向)。
 */
import { AI_PURPOSE_INSIGHT } from "../ai/constants";
import { chatJsonTask, type ParsedTask } from "../ai/chat-json-task";
import { readExtraMaxTokens } from "../ai/extra-params";
import { countTodayRoleUsage } from "../ai/usage-queries";
import { getRoleDailyMax, resolveAiModel } from "../ai/resolver";
import { prisma } from "../db";
import { logger } from "../logger";
import { statsDay } from "../datetime";
import { topVectorMatches } from "../search/embedding-repo";
import { unionMedia } from "./cluster";
import {
  ANOMALY_MIN_SCORE,
  ANOMALY_RATIO,
  COVERAGE_COVERED,
  COVERAGE_MATCH_DISTANCE,
  COVERAGE_PARTIAL,
  COVERAGE_SATURATION,
  COVERAGE_TOPK,
  FADE_AFTER_DAYS,
  LABEL_BATCH_SIZE,
  LABEL_MIN_MEMBERS,
  LABEL_SAMPLE_SIZE,
  LABEL_SAMPLE_TEXT_MAX,
  SCORE_GAP_WEIGHT,
  SCORE_HEAT_SATURATION,
  SCORE_HEAT_WINDOW_DAYS,
  SCORE_HEAT_WEIGHT,
  SCORE_MEDIA_MAX,
  SCORE_MEDIA_WEIGHT,
} from "./constants";
import { getClusterCentroid } from "./embedding-repo";

// ── 纯函数段(单测锚点)──────────────────────────────────────────────

/** 机会评分卡(方案 §2 介质数加权,0-100 三项 40/30/30;coverage=null 视为
 * 未覆盖=空白项满额,促日批尽快回写) */
export function computeOpportunityScore(input: {
  mediaCount: number;
  heatNew: number;
  coverage: number | null;
}): number {
  const mediaBonus =
    (Math.min(Math.max(input.mediaCount, 0), SCORE_MEDIA_MAX) / SCORE_MEDIA_MAX) *
    SCORE_MEDIA_WEIGHT;
  const heatBonus =
    (Math.min(Math.max(input.heatNew, 0), SCORE_HEAT_SATURATION) / SCORE_HEAT_SATURATION) *
    SCORE_HEAT_WEIGHT;
  const gapBonus =
    (input.coverage === null ? 1 : 1 - Math.min(Math.max(input.coverage, 0), 1)) * SCORE_GAP_WEIGHT;
  return Math.round(mediaBonus + heatBonus + gapBonus);
}

/** 覆盖度分(纯函数):最佳相似度 × 命中数饱和因子(0-1,两位小数) */
export function computeCoverageScore(bestDistance: number, matchedCount: number): number {
  const bestSim = Math.min(Math.max(1 - bestDistance, 0), 1);
  const countFactor = Math.min(matchedCount, COVERAGE_SATURATION) / COVERAGE_SATURATION;
  return Math.round(bestSim * countFactor * 100) / 100;
}

/** 覆盖档位(纯函数):covered / partial / blank(空白=选题机会,痛点卡标红) */
export function coverageStateOf(score: number): "covered" | "partial" | "blank" {
  if (score >= COVERAGE_COVERED) return "covered";
  if (score >= COVERAGE_PARTIAL) return "partial";
  return "blank";
}

/** 异动判定(纯函数,方案 §5.5):最新分 ≥ 前 3 日均值 ANOMALY_RATIO 倍且
 * 绝对增量 ≥ ANOMALY_MIN_SCORE;history 升序、末位=最新;前窗无数据=无基线
 * 不告警(防冷启动假告警) */
export function isAnomaly(historyAsc: number[]): boolean {
  if (historyAsc.length < 2) return false;
  const latest = historyAsc[historyAsc.length - 1]!;
  const prev = historyAsc.slice(Math.max(0, historyAsc.length - 1 - 3), historyAsc.length - 1);
  if (prev.length === 0) return false;
  const mean = prev.reduce((a, b) => a + b, 0) / prev.length;
  if (mean <= 0) return false;
  return latest >= ANOMALY_RATIO * mean && latest - mean >= ANOMALY_MIN_SCORE;
}

export interface InsightLabelContract {
  label: string;
  summary: string;
  keywords: string[];
}

/** 打标契约解析(解析失败只回错误串,chatJsonTask 据此重试;永不 throw) */
export function parseInsightLabel(raw: string): ParsedTask<InsightLabelContract> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "输出不是合法 JSON" };
  }
  if (typeof data !== "object" || data === null) return { ok: false, error: "顶层不是对象" };
  const o = data as Record<string, unknown>;
  if (typeof o.label !== "string" || o.label.trim() === "") {
    return { ok: false, error: "label 缺失或为空" };
  }
  if (typeof o.summary !== "string" || o.summary.trim() === "") {
    return { ok: false, error: "summary 缺失或为空" };
  }
  const keywords = Array.isArray(o.keywords)
    ? o.keywords.filter((k): k is string => typeof k === "string" && k.trim() !== "")
    : [];
  if (keywords.length === 0) return { ok: false, error: "keywords 缺失或为空数组" };
  return {
    ok: true,
    data: {
      label: o.label.trim().slice(0, 200),
      summary: o.summary.trim().slice(0, 1000),
      keywords: keywords.slice(0, 8).map((k) => k.trim().slice(0, 40)),
    },
  };
}

// ── 打标段 ────────────────────────────────────────────────────────────

const LABEL_SYSTEM = `你是内容运营洞察分析师。给定同一主题下聚合的一组用户信号原话(搜索词/提问/评论/反馈),为这组信号归纳一个可读的簇:
{"label":"簇名(≤20字,概括需求/话题本身的人话短语,勿罗列样本原词)","summary":"一句话概括(≤60字,这组信号反映的共性诉求或现象)","keywords":["关键词3-8个"]}
只输出一个 JSON 对象,不要任何解释。`;

interface StaleClusterRow {
  id: bigint;
  members: bigint;
}

/** 待打标簇(active、成员达标、未打标或有新增;最近活跃优先)。
 * 聚合条件全走 HAVING(WHERE 不容聚合;label 函数依赖分组主键,PG 允许) */
async function findStaleClusters(limit: number): Promise<StaleClusterRow[]> {
  return prisma.$queryRaw<StaleClusterRow[]>`
    SELECT c.id, count(*) AS members
      FROM insight_cluster c
      JOIN insight_cluster_member m ON m.cluster_id = c.id
     WHERE c.status = 'active'
     GROUP BY c.id
    HAVING count(*) >= ${LABEL_MIN_MEMBERS}
       AND (c.label IS NULL OR count(*) > c.labeled_member_count)
     ORDER BY max(c.last_seen_at) DESC
     LIMIT ${limit}`;
}

interface LabelSample {
  rawText: string;
  source: string;
}

/** 打标输入样本(最近成员优先;rawText 截断防 prompt 爆量) */
async function fetchLabelSamples(clusterId: bigint): Promise<LabelSample[]> {
  const rows = await prisma.insightSignal.findMany({
    where: { members: { some: { clusterId } } },
    orderBy: { signalAt: "desc" },
    take: LABEL_SAMPLE_SIZE,
    select: { rawText: true, source: true },
  });
  return rows.map((r) => ({
    rawText: r.rawText.slice(0, LABEL_SAMPLE_TEXT_MAX),
    source: r.source,
  }));
}

/** 单簇打标;永不 throw(失败返回 false 交批次汇总) */
async function labelCluster(
  clusterId: bigint,
  memberCount: number,
  model: Awaited<ReturnType<typeof resolveAiModel>>,
): Promise<boolean> {
  if (!model) return false;
  const [samples, cluster] = await Promise.all([
    fetchLabelSamples(clusterId),
    prisma.insightCluster.findUnique({
      where: { id: clusterId },
      select: { label: true, summary: true },
    }),
  ]);
  if (samples.length === 0) return false;
  const sampleText = samples.map((s, i) => `${i + 1}. [${s.source}] ${s.rawText}`).join("\n");
  const prior =
    cluster?.label != null
      ? `\n(本簇已有命名「${cluster.label}」与概括「${cluster.summary ?? ""}」;成员有新增,可沿用或按新材料更名)`
      : "";
  const user = `信号样本 ${memberCount} 条(展示最近 ${samples.length} 条):\n${sampleText}${prior}`;
  const parsed = await chatJsonTask<InsightLabelContract>(
    model,
    parseInsightLabel,
    LABEL_SYSTEM,
    user,
    AI_PURPOSE_INSIGHT,
    { maxTokens: readExtraMaxTokens(model.extraParams) ?? undefined },
  );
  const [mediaRows, memberCountNow] = await Promise.all([
    prisma.insightSignal.findMany({
      where: { members: { some: { clusterId } } },
      select: { medium: true },
    }),
    prisma.insightClusterMember.count({ where: { clusterId } }),
  ]);
  await prisma.insightCluster.update({
    where: { id: clusterId },
    data: {
      label: parsed.label,
      summary: parsed.summary,
      keywords: parsed.keywords,
      media: unionMedia([mediaRows.map((r) => r.medium)]),
      labeledAt: new Date(),
      // 基 LLM 调用期间的最新成员数记账,避免把打标间隙的新增误判为「未打标新增」
      labeledMemberCount: Math.max(memberCount, memberCountNow),
    },
    select: { id: true },
  });
  return true;
}

// ── 覆盖度/评分/快照段 ────────────────────────────────────────────────

interface ActiveClusterStat {
  id: bigint;
  kind: string;
  members: number;
  heatNew: number;
  media: string[];
}

/** 活跃簇机械段聚合(成员数/近 7 日新增热度/介质并集,一条 SQL 出全量) */
async function fetchActiveClusterStats(since: Date): Promise<ActiveClusterStat[]> {
  const rows = await prisma.$queryRaw<
    {
      id: bigint;
      kind: string;
      members: bigint;
      heat: bigint;
      media: string[];
    }[]
  >`
    SELECT c.id,
           c.kind,
           count(m.id) AS members,
           count(s.id) FILTER (WHERE s.signal_at >= ${since}) AS heat,
           COALESCE(array_agg(DISTINCT s.medium) FILTER (WHERE s.medium IS NOT NULL), '{}') AS media
      FROM insight_cluster c
      LEFT JOIN insight_cluster_member m ON m.cluster_id = c.id
      LEFT JOIN insight_signal s ON s.id = m.signal_id
     WHERE c.status = 'active'
     GROUP BY c.id, c.kind`;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    members: Number(r.members),
    heatNew: Number(r.heat),
    media: r.media ?? [],
  }));
}

/** 痛点簇覆盖度:质心 → post 向量近邻(方案 §5.6;无标签/无质心跳过) */
async function refreshCoverage(clusterId: bigint): Promise<void> {
  const [centroid, labeled] = await Promise.all([
    getClusterCentroid(clusterId),
    prisma.insightCluster.findUnique({
      where: { id: clusterId },
      select: { label: true, kind: true },
    }),
  ]);
  if (!centroid || !labeled?.label || labeled.kind !== "pain") return;
  const matches = await topVectorMatches("post", centroid, COVERAGE_TOPK);
  const matched = matches.filter((m) => m.distance <= COVERAGE_MATCH_DISTANCE);
  const best = matched[0]?.distance ?? matches[0]?.distance ?? 1;
  const score = matched.length > 0 ? computeCoverageScore(best, matched.length) : 0;
  await prisma.insightCluster.update({
    where: { id: clusterId },
    data: { coverageScore: score, coverageState: coverageStateOf(score) },
    select: { id: true },
  });
}

/** 每日快照 upsert(北京日界;rank=同 kind 内分数名次) */
async function upsertSnapshots(
  scored: { id: bigint; kind: string; score: number }[],
  date: string,
): Promise<void> {
  const rankByKind = new Map<string, number>();
  const withRank = [...scored]
    .sort((a, b) => b.score - a.score)
    .map((r) => {
      const rank = (rankByKind.get(r.kind) ?? 0) + 1;
      rankByKind.set(r.kind, rank);
      return { ...r, rank };
    });
  for (const r of withRank) {
    await prisma.$executeRaw`
      INSERT INTO insight_snapshot (cluster_id, date, score, rank)
      VALUES (${r.id}::bigint, ${date}::date, ${r.score}::float8, ${r.rank}::int)
      ON CONFLICT (cluster_id, date) DO UPDATE
        SET score = EXCLUDED.score, rank = EXCLUDED.rank`;
  }
}

// ── 日批编排 ──────────────────────────────────────────────────────────

export interface InsightDailySummary {
  labeled: number;
  labelFailed: number;
  /** 打标跳过(未绑定 insight 模型或当日配额已满) */
  labelSkipped: boolean;
  scored: number;
  snapshots: number;
  faded: number;
  covered: number;
}

/** 洞察日批主流程(worker cron 与手动脚本共用;process 级自愈,不抛) */
export async function runInsightDaily(): Promise<InsightDailySummary> {
  const summary: InsightDailySummary = {
    labeled: 0,
    labelFailed: 0,
    labelSkipped: false,
    scored: 0,
    snapshots: 0,
    faded: 0,
    covered: 0,
  };
  const model = await resolveAiModel(AI_PURPOSE_INSIGHT);
  if (!model) {
    logger.info({ event: "insight.daily_label_skipped", reason: "insight_unbound" });
    summary.labelSkipped = true;
  } else {
    const [used, dailyMax] = await Promise.all([
      countTodayRoleUsage(AI_PURPOSE_INSIGHT),
      getRoleDailyMax(AI_PURPOSE_INSIGHT),
    ]);
    const quota = Math.max(0, dailyMax - used);
    if (quota === 0) {
      logger.info({ event: "insight.daily_label_skipped", reason: "quota_exhausted" });
      summary.labelSkipped = true;
    } else {
      const stale = await findStaleClusters(Math.min(quota, LABEL_BATCH_SIZE));
      for (const c of stale) {
        try {
          if (await labelCluster(c.id, Number(c.members), model)) summary.labeled += 1;
          else summary.labelFailed += 1;
        } catch (e) {
          summary.labelFailed += 1;
          logger.warn({
            event: "insight.label_cluster_failed",
            clusterId: c.id.toString(),
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }

  // 机械段:评分 + 快照 + fading(与打标解耦,LLM 不可用日照常演进)
  const now = new Date();
  const since = new Date(now.getTime() - SCORE_HEAT_WINDOW_DAYS * 86_400_000);
  const [stats, activeRows] = await Promise.all([
    fetchActiveClusterStats(since),
    prisma.insightCluster.findMany({
      where: { status: "active" },
      select: { id: true, score: true, peakAt: true, coverageScore: true },
    }),
  ]);
  const activeById = new Map(activeRows.map((r) => [r.id, r]));
  const scored = stats
    .filter((s) => s.members > 0)
    .map((s) => {
      const prev = activeById.get(s.id);
      return {
        id: s.id,
        kind: s.kind,
        score: computeOpportunityScore({
          mediaCount: s.media.length,
          heatNew: s.heatNew,
          coverage: prev?.coverageScore ?? null,
        }),
        prevScore: prev?.score ?? null,
        hadPeak: prev?.peakAt !== null && prev?.peakAt !== undefined,
      };
    });
  const nowMs = Date.now();
  for (const s of scored) {
    await prisma.insightCluster.update({
      where: { id: s.id },
      data: {
        score: s.score,
        // 首次计分或创新高 → peakAt=now(峰值锚点,雷达趋势读侧用)
        peakAt: !s.hadPeak || (s.prevScore ?? -1) < s.score ? new Date(nowMs) : undefined,
      },
      select: { id: true },
    });
  }
  summary.scored = scored.length;
  await upsertSnapshots(scored, statsDay(now));
  summary.snapshots = scored.length;

  const cutoff = new Date(nowMs - FADE_AFTER_DAYS * 86_400_000);
  summary.faded = await prisma.$executeRaw`
    UPDATE insight_cluster SET status = 'fading'
     WHERE status = 'active' AND last_seen_at < ${cutoff}`;

  // 覆盖度只重算已打标痛点簇(标签变化后次日回写,量级=数十,可承受)
  const covTargets = await prisma.insightCluster.findMany({
    where: { kind: "pain", status: "active", label: { not: null } },
    select: { id: true },
  });
  for (const t of covTargets) {
    try {
      await refreshCoverage(t.id);
      summary.covered += 1;
    } catch (e) {
      logger.warn({
        event: "insight.coverage_failed",
        clusterId: t.id.toString(),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  logger.info({ event: "insight.daily", ...summary });
  return summary;
}
