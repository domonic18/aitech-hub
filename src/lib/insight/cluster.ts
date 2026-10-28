/**
 * 增量聚类(M34 批②,方案 §5.3;批③ 验收三轮·痛点扩围):新信号向量 →
 * 既有簇成员近邻(阈值判定)归簇,否则建新簇。**单池归簇**:近邻搜索不再按
 * kind 分池——热点/痛点是簇内容的语义属性而非源属性,同主题跨源信号合流入
 * 簇,kind 由 LLM 打标日批按语义判定(label.ts);源映射 INSIGHT_SOURCE_KIND
 * 仅作新建簇的初始引导值。簇合并/分裂留 LLM 日批审(本批不实现)。
 * 判定与介质并集为纯函数(单测锚点);写侧逐信号自吞异常——单条失败不殃及
 * 批内其余,下轮 findUnclusteredSignals 重扫自愈(embed-reconcile 同取向)。
 */
import { prisma } from "../db";
import { logger } from "../logger";
import { INSIGHT_SOURCES_ENABLED } from "./ingest";
import {
  CLUSTER_MATCH_DISTANCE,
  CLUSTER_MIN_TEXT_LEN,
  CLUSTER_SHORT_MATCH_DISTANCE,
  INSIGHT_MEDIA_VOCAB,
  INSIGHT_SOURCE_KIND,
} from "./constants";
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

/** 归簇判定(纯函数):短文本不建簇、仅严阈值就近归入既有簇(M52 批D,
 * outlier reduction 思路);正常文本距离 ≤ 阈值归簇,否则建新簇 */
export function decideAssignment(
  nearest: ClusterNearMatch | undefined,
  textLen: number,
  minTextLen: number,
  matchDistance: number,
  shortMatchDistance?: number,
): AssignDecision {
  if (textLen < minTextLen) {
    if (
      shortMatchDistance !== undefined &&
      nearest !== undefined &&
      nearest.distance <= shortMatchDistance
    ) {
      return { action: "join", clusterId: nearest.clusterId };
    }
    return { action: "short" };
  }
  if (nearest !== undefined && nearest.distance <= matchDistance) {
    return { action: "join", clusterId: nearest.clusterId };
  }
  return { action: "create" };
}

/** 簇介质 = 成员介质并集(方案 §2 留痕介质;词表自 constants 单源,未知源值丢弃) */
const MEDIA_VOCAB: readonly string[] = INSIGHT_MEDIA_VOCAB;

export function unionMedia(medias: (readonly string[] | null | undefined)[]): string[] {
  const set = new Set<string>();
  for (const m of medias) {
    for (const x of m ?? []) {
      if (MEDIA_VOCAB.includes(x)) set.add(x);
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
  // 工作集下限 1(M52 批D):短文本进工作集走严配归簇,不再整段盲区
  const workset = await findUnclusteredSignals(limit, 1, [...INSIGHT_SOURCES_ENABLED]);
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
        // 未知源(新源未登记 kind 映射):不入簇留痕,下轮重扫直至扩表
        // (kind 仅作新建簇引导值,仍需登记防脏源静默)
        summary.short += 1;
        continue;
      }
      // 单池近邻:按信号自身领域搜索(M54 同域分桶——领域来自分类 sweep)
      const nearest = await nearestClustersByMembers(sig.vector, sig.domain, 1);
      const decision = decideAssignment(
        nearest[0],
        sig.normalizedText.length,
        CLUSTER_MIN_TEXT_LEN,
        CLUSTER_MATCH_DISTANCE,
        CLUSTER_SHORT_MATCH_DISTANCE,
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
        // 建新簇:kind=源映射引导值(LLM 打标日批按语义覆判);label 未打标
        // null,LLM 日批回填;media=首条信号介质,
        // 嵌套 create 同事务落 member(原子,防半建簇)
        await prisma.insightCluster.create({
          data: {
            kind,
            domain: sig.domain,
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
