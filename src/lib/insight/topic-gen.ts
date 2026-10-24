/**
 * 洞察簇 → 创作选题一键转化(M46 验收批,板终态 F25/F26 落地):洞察中心
 * 详情页「生成选题」把簇直接转成创作中心的专题,免去手动建题与逐条挂素材:
 * - 建题:title 取簇 label(LLM 打标;未打标退回首关键词),定位拼簇概括与
 *   关联词,主意图缺省 article(建题后仍可在创作中心改);
 * - 自动挂载:成员信号里 telegram-ai 源(refId = telegram 行 id,ingest 写侧
 *   约定)按成员权重降序取前 N 条电报,逐条 mountMaterial——视频须解读完成/
 *   文本须可见,单条不合格自吞跳过不殃及建题与整体;幂等可重入(重复点击
 *   不重复挂,已挂过的不计新挂数)。
 * 素材接地纪律不变:只挂系统内既有素材,存在性/可用性由 mountMaterial 校验。
 */
import { prisma } from "../db";
import { logger } from "../logger";
import { TopicError } from "../topics/errors";
import { mountMaterial } from "../topics/materials";
import { createTopic } from "../topics/repo";

/** 电报解读源信号(InsightSignal.source 白名单值) */
const TELEGRAM_SOURCE = "telegram-ai";
/** 单次自动挂载上限(防大簇一次挂几十条稀释创作焦点) */
const MOUNT_CAP = 5;
const TITLE_MAX = 200;
const POSITIONING_MAX = 1000;

export interface TopicFromClusterResult {
  topicId: bigint;
  title: string;
  /** 实际新挂上的素材数(此前已挂过的不计) */
  mounted: number;
  /** 候选电报信号数(含不合格被跳过的) */
  scanned: number;
}

export async function createTopicFromCluster(clusterId: bigint): Promise<TopicFromClusterResult> {
  const cluster = await prisma.insightCluster.findUnique({
    where: { id: clusterId },
    select: {
      id: true,
      label: true,
      summary: true,
      keywords: true,
      members: {
        orderBy: [{ weight: { sort: "desc", nulls: "last" } }, { id: "asc" }],
        select: { signal: { select: { source: true, refId: true } } },
      },
    },
  });
  if (!cluster) throw new TopicError("not_found", "洞察簇不存在");

  const keywords = Array.isArray(cluster.keywords)
    ? cluster.keywords.filter((k): k is string => typeof k === "string")
    : [];
  const title = (cluster.label?.trim() || keywords[0]?.trim() || "洞察选题").slice(0, TITLE_MAX);
  const positioning = [
    cluster.summary?.trim() || null,
    keywords.length > 0 ? `关联词:${keywords.join("、")}` : null,
  ]
    .filter((s): s is string => s !== null)
    .join("\n")
    .slice(0, POSITIONING_MAX);
  const topic = await createTopic({ title, positioning: positioning || undefined });

  const candidates = cluster.members
    .map((m) => m.signal)
    .filter((s) => s.source === TELEGRAM_SOURCE && /^\d+$/.test(s.refId));
  let mounted = 0;
  for (const sig of candidates.slice(0, MOUNT_CAP)) {
    try {
      const { created } = await mountMaterial(topic.id, "telegram", BigInt(sig.refId));
      if (created) mounted += 1;
    } catch (e) {
      // 单条不合格(未解读/已隐藏/已删)自吞跳过,建题成果不回滚
      logger.warn({
        event: "insight.topic_mount_skipped",
        clusterId: clusterId.toString(),
        topicId: topic.id.toString(),
        refId: sig.refId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  logger.info({
    event: "insight.topic_created_from_cluster",
    clusterId: clusterId.toString(),
    topicId: topic.id.toString(),
    mounted,
    scanned: candidates.length,
  });
  return { topicId: topic.id, title, mounted, scanned: candidates.length };
}
