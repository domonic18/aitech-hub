/**
 * 各队列的 worker 级参数(并发/锁续期)单源(M58 偿债:此表此前是 index.ts 里
 * 一串内联三元,队列增多后已不可读)。默认并发 2,下表只写偏差点。
 *
 * 落点说明:不放 src/lib/queue.ts——那是 producer 侧且已 import bullmq,是
 * 浏览器包的禁入面;worker 运行态配置与 processors/schedules 同居 worker/。
 */
import {
  QUEUE_COVER_GEN,
  QUEUE_DB_BACKUP,
  QUEUE_DISCOVERY,
  QUEUE_DISTRIBUTE,
  QUEUE_DISTRIBUTE_XHS,
  QUEUE_ILLUSTRATION_STUDIO,
  QUEUE_INSIGHT,
  QUEUE_INTERPRETER,
  QUEUE_MEDIA_TRANSFER,
  QUEUE_PAY_RECONCILE,
  QUEUE_SEO_BATCH,
  QUEUE_SUMMARIZER,
} from "../src/lib/queue";

export interface QueueWorkerOpts {
  concurrency?: number;
  lockDuration?: number;
}

/** 每个 Worker 的启动参数(未列出的队列走默认:并发 2 + BullMQ 默认锁) */
export const QUEUE_WORKER_OPTS: Record<string, QueueWorkerOpts> = {
  // 外链抓取 / 抓原文+LLM / 云厂商生图(10-30s+):耗时不定,放宽锁续期
  [QUEUE_MEDIA_TRANSFER]: { lockDuration: 300_000 },
  [QUEUE_SUMMARIZER]: { lockDuration: 300_000 },
  [QUEUE_COVER_GEN]: { lockDuration: 300_000 },
  // interpreter:ffmpeg 抽轨 CPU 峰值(arch/02 §3.2);seo-batch:逐篇 LLM 防打爆模型速率
  [QUEUE_INTERPRETER]: { concurrency: 1, lockDuration: 600_000 },
  [QUEUE_SEO_BATCH]: { concurrency: 1, lockDuration: 600_000 },
  // 微信接口频控全局串行;锁 900s 覆盖单批 30 篇 × ~15s。
  // 新渠道走 distributeQueueFor 子队列,届时按渠道各建 worker(同并发 1 语义),互不队头阻塞
  [QUEUE_DISTRIBUTE]: { concurrency: 1, lockDuration: 900_000 },
  // 小红书 Playwright 发布分钟级
  [QUEUE_DISTRIBUTE_XHS]: { concurrency: 1, lockDuration: 600_000 },
  // dump + 上传分钟级
  [QUEUE_DB_BACKUP]: { concurrency: 1, lockDuration: 600_000 },
  // 查单/关单/补发按单串行,防双拍交错
  [QUEUE_PAY_RECONCILE]: { concurrency: 1 },
  // 视频平台风控纪律全局串行;双窗全词 5-10min
  [QUEUE_DISCOVERY]: { concurrency: 1, lockDuration: 900_000 },
  // 日批 LLM 分钟级;并发 1 防双拍交错归簇
  [QUEUE_INSIGHT]: { concurrency: 1, lockDuration: 600_000 },
  // 拆层 ~75s + 逐层转存;并发 1 防打爆单绑定模型
  [QUEUE_ILLUSTRATION_STUDIO]: { concurrency: 1, lockDuration: 600_000 },
};
