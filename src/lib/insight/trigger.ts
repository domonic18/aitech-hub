/**
 * 洞察任务手动触发(验收二批①):「热榜拉取」与「洞察日批」入 insight 队列
 * 一次性 job,jobId 带 manual 前缀与 cron 调度 job 不冲突;入队即返回,执行
 * 与逐源闸/LLM 节奏在 worker。语义对齐 discovery/admin#triggerDiscovery。
 */
import { logger } from "../logger";
import { INSIGHT_JOB_DAILY, INSIGHT_JOB_FETCH, QUEUE_INSIGHT, getQueue } from "../queue";

export type InsightTriggerJob = "hotboard" | "daily";

export async function triggerInsight(job: InsightTriggerJob): Promise<{ enqueued: true }> {
  const name = job === "hotboard" ? INSIGHT_JOB_FETCH : INSIGHT_JOB_DAILY;
  await getQueue(QUEUE_INSIGHT).add(
    name,
    {},
    {
      jobId: `${name}-manual-${Date.now()}`,
      removeOnComplete: 200,
      removeOnFail: 200,
    },
  );
  logger.info({ event: "insight.triggered", job });
  return { enqueued: true };
}
