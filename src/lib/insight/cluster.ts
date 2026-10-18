/**
 * 增量聚类(M34 批②,方案 §5.3):新信号向量 → 既有簇成员近邻(阈值判定)
 * 归簇,否则建新簇;簇合并/分裂留 LLM 日批审(本批不实现,方案原文取向)。
 * 判定与介质并集为纯函数(单测锚点);写侧逐信号自吞异常——单条失败不殃及
 * 批内其余,下轮 findUnclusteredSignals 重扫自愈(embed-reconcile 同取向)。
 */
import { prisma } from "../db";
import { logger } from "../logger";
import { INSIGHT_SOURCES_ENABLED } from "./ingest";
import { CLUSTER_MATCH_DISTANCE, CLUSTER_MIN_TEXT_LEN, INSIGHT_SOURCE_KIND } from "./constants";
import {
  type ClusterNearMatch,
  findUnclusteredSignals,
  nearestClustersByMembers,
} from "./embedding-repo";

export type ClusterAction = "join" | "create" | "short";

export interface AssignDecision {
  action: ClusterAction;
  clusterId?: bigint;
}

/** 归簇判定(纯函数):文本过短不入簇;最近簇距离 ≤ 阈值归簇,否则建新簇 */
export function decideAssignment(
  nearest: ClusterNearMatch | undefined,
  textLen: number,
  minTextLen: number,
  matchDistance: number,
): AssignDecision {
  if (textLen < minTextLen) return { action: "short" };
  if (nearest !== undefined && nearest.distance <= matchDistance) {
    return { action: "join", clusterId: nearest.clusterId };
  }
  return { action: "create" };
}

/** 簇介质 = 成员介质并集(方案 §2 留痕介质;五值白名单,未知源值丢弃) */
const MEDIA_VOCAB = ["money", "time", "voice", "search", "ai-record"] as const;

export function unionMedia(medias: (readonly string[] | null | undefined)[]): string[] {
  const set = new Set<string>();
  for (const m of medias) {
    for (const x of m ?? []) {
      if ((MEDIA_VOCAB as readonly string[]).includes(x)) set.add(x);
    }
  }
  return [...set];
}

export interface ClusterRunSummary {
  /** 本轮工作集大小 */
  scanned: number;
  /** 归入既有簇 */
  joined: number;
  /** 新建簇(含成员 1 条) */
  created: number;
  /** 过短/未知源跳过 */
  short: number;
  failed: number;
}

/** 聚类主流程(embed job 与手动脚本共用;process 级自愈,不抛) */
export async function runInsightClustering(limit: number): Promise<ClusterRunSummary> {
  const workset = await findUnclusteredSignals(limit, CLUSTER_MIN_TEXT_LEN, [
    ...INSIGHT_SOURCES_ENABLED,
  ]);
  const summary: ClusterRunSummary = {
    scanned: workset.length,
    joined: 0,
    created: 0,
    short: 0,
    failed: 0,
  };

  for (const sig of workset) {
    try {
      const kind = INSIGHT_SOURCE_KIND[sig.source as keyof typeof INSIGHT_SOURCE_KIND];
      if (kind === undefined) {
        // 未知源(批③ 新源未登记 kind 映射):不入簇留痕,下轮重扫直至扩表
        summary.short += 1;
        continue;
      }
      const nearest = await nearestClustersByMembers(sig.vector, kind, "tech", 1);
      const decision = decideAssignment(
        nearest[0],
        sig.normalizedText.length,
        CLUSTER_MIN_TEXT_LEN,
        CLUSTER_MATCH_DISTANCE,
      );
      if (decision.action === "short") {
        summary.short += 1;
        continue;
      }
      if (decision.action === "join" && decision.clusterId !== undefined) {
        await prisma.$transaction([
          prisma.insightClusterMember.create({
            data: {
              clusterId: decision.clusterId,
              signalId: sig.id,
              weight: 1 - (nearest[0]?.distance ?? 0),
            },
            select: { id: true },
          }),
          prisma.insightCluster.update({
            where: { id: decision.clusterId },
            data: { lastSeenAt: new Date() },
            select: { id: true },
          }),
        ]);
        summary.joined += 1;
      } else {
        // 建新簇:label 未打标 null,LLM 日批回填;media=首条信号介质,
        // 嵌套 create 同事务落 member(原子,防半建簇)
        await prisma.insightCluster.create({
          data: {
            kind,
            domain: "tech",
            media: [sig.medium],
            members: { create: { signalId: sig.id, weight: 1 } },
          },
          select: { id: true },
        });
        summary.created += 1;
      }
    } catch (e) {
      summary.failed += 1;
      logger.warn({
        event: "insight.cluster_signal_failed",
        signalId: sig.id.toString(),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  logger.info({ event: "insight.cluster_run", ...summary });
  return summary;
}
