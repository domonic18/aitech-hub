/**
 * 视频解读(M9,arch/02 §3.2):interpreter 队列编排——下载无水印流 → ffmpeg 抽音轨 →
 * 云 ASR 转写 → LLM 结构化概括(topic/summary/points)→ telegram.ai_* 列落库。
 * 版权红线:「转写是输入,不是资产」——不设 transcript 列,play_url 仅经 job data
 * 过境(removeOnComplete/Fail 50 压 Redis 痕迹),临时音视频文件判读 try/finally 即删。
 * ASR 终败(重试≤2)→ missing_transcript 降级:仍走 LLM 基于文案元数据概括,不阻塞入流。
 */
import { prisma } from "../db";
import { getQueue, QUEUE_INTERPRETER } from "../queue";
import { AI_PURPOSE_INTERPRET } from "../ai/constants";
import { resolveAiModel } from "../ai/resolver";

/** interpret job data:playUrl 过境字段(job 消费完随保留窗口即焚),禁落库 */
export interface InterpretJobData {
  /** telegram.id(BigInt → string 出口惯例) */
  telegramId: string;
  /** 平台作品 id:存量补解读经网关重拉 listing 的匹配锚 */
  videoId: string | null;
  /** 无水印直链(临时签名 URL);null=入库时未透出,processor 现场重取 */
  playUrl: string | null;
  platform: string;
  secUid: string;
}

/** 解读就绪 = ASR 渠道已启用 + interpret 角色已绑定可用模型(未配置是运营态,不标条目失败) */
export async function isInterpretReady(): Promise<boolean> {
  const asr = await prisma.asrConfig.findUnique({ where: { id: 1 }, select: { enabled: true } });
  if (!asr?.enabled) return false;
  return (await resolveAiModel(AI_PURPOSE_INTERPRET)) !== null;
}

/** 入队解读(jobId=interpret:{id} 幂等;attempts 兜下载/网关网络层,ASR 重试在管道内) */
export async function enqueueInterpret(data: InterpretJobData): Promise<void> {
  await getQueue(QUEUE_INTERPRETER).add("interpret-video", data, {
    jobId: `interpret:${data.telegramId}`,
    attempts: 3,
    backoff: { type: "fixed", delay: 60_000 },
    removeOnComplete: 50, // 压低 playUrl 在 Redis 的残留条数
    removeOnFail: 50,
  });
}
