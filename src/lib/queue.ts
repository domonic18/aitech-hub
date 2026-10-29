import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

import { env } from "./env";
import { CHANNEL_WECHAT, CHANNEL_XHS } from "./distribute/channels";

/**
 * BullMQ producer 侧封装(arch/00-overview §2:请求内只 enqueue,处理一律在 worker 进程)。
 * BullMQ 要求连接 maxRetriesPerRequest: null,与应用侧 lib/redis.ts 分开建连。
 */
export const QUEUE_MEDIA_PROCESS = "media-process";
/** 一键发文外链图转存(md 导入;arch/05-services §4.2,失败标 error 供编辑器提示) */
export const QUEUE_MEDIA_TRANSFER = "media-transfer";
/** 媒体体检(每日定时 + 后台手动触发;arch/08-media §3.2) */
export const QUEUE_MEDIA_AUDIT = "media-audit";
/** 站点统计日聚合(requirement §3.5:beacon → Redis 缓冲 → worker 聚合落库) */
export const QUEUE_STATS = "stats";
/** 电报流采集(M7:tick 扫到期来源 → 逐源 crawl job,单源失败隔离;arch/02 §3) */
export const QUEUE_CRAWLER = "crawler";
/** 视频解读(M9:下载→抽轨→ASR→LLM 概括;并发 1——ffmpeg 是 CPU 峰值,arch/02 §3.2) */
export const QUEUE_INTERPRETER = "interpreter";
/** 文字资讯轻解读(M12 批③:一句话中心思想 + 要点 + 关键词;与视频分队列防长任务阻塞) */
export const QUEUE_SUMMARIZER = "summarizer";
/** GitHub 项目展示(M11:tick 扫到期白名单仓 → 逐仓 sync job,单仓失败隔离;arch/05 §4) */
export const QUEUE_GITHUB = "github";
/** 文生图封面(M14 批⑥,验收反馈问题6):编辑器「AI 生成候选」→ worker 生图入
 * 媒体库 + 候选落库,编辑器凭 token 轮询;云厂商生图 10-30s,不占请求(请求内禁秒级任务) */
export const QUEUE_COVER_GEN = "cover-gen";
/** 批量 SEO 补全(M16 问题8,仅补空缺):文章管理多选 → 单批次 job 顺序逐篇;
 * LLM 秒级调用 × ≤50 篇,并发 1 防打爆绑定模型,lockDuration 600s 兜底 */
export const QUEUE_SEO_BATCH = "seo-batch";
/** 内容分发(M17,requirement §4 多渠道分发):公众号推草稿;
 * 并发 1 全局串行(微信接口频控),lockDuration 900s 覆盖单批 30 篇 × ~15s */
export const QUEUE_DISTRIBUTE = "distribute";
/** 牌价数据通道(M55:官方页爬虫;批B OpenRouter 预填通道 2026-10-29 砍除) */
export const QUEUE_PRICING = "pricing";
export const PRICING_JOB_CRAWL = "crawl-official";
/** 分发队列按渠道路由(M48 批D 地基):wechat 沿用历史队列名——改名会弃生产
 * 在途 job,禁;新渠道(小红书等)一律 `distribute:<channel>` 子队列,worker 侧
 * 按渠道各建 worker(同 concurrency=1 语义),渠道间互不队头阻塞 */
/** 子队列命名规约:分隔符用「-」——BullMQ 队列名禁冒号(与 jobId 同规),
 * 2026-10-26 曾用「:」致 worker 启动即崩(M49 批X2' 转向 agent 会话后此路
 * 由保留给未来真实 job 渠道) */
export function distributeQueueFor(channel: string): string {
  return channel === CHANNEL_WECHAT ? QUEUE_DISTRIBUTE : `${QUEUE_DISTRIBUTE}-${channel}`;
}

/** 小红书自动发布(M49 批X3):贴图渠道行的发布 job(worker 调 xhs-gateway) */
export const DISTRIBUTE_JOB_XHS_AUTO = "xhs-auto-publish";
export const QUEUE_DISTRIBUTE_XHS = distributeQueueFor(CHANNEL_XHS);
/** 小红书登录态每日探照(M50 批F;挂 distribute 队列,04 段错峰) */
export const DISTRIBUTE_JOB_XHS_STATE_PROBE = "xhs-state-probe";

/** 数据库每日备份(M19 批②,M6 异机存放):pg_dump -Fc → 备份桶,本地留 3 份;
 * 并发 1 + 锁 600s(dump+上传分钟级),失败进 failed 队列可见 */
export const QUEUE_DB_BACKUP = "db-backup";
/** 混合检索 embedding 对账(M20 批②):扫 stale 三域 → 批 embed → upsert 向量 */
export const QUEUE_EMBED = "embed-content";
/** 事务邮件(M21 批⓪,D1 邮箱通道):注册验证/绑定/找回密码;SMTP 外呼秒级,
 *  请求内只 enqueue(worker 发送);SMTP 未配置时发送侧显式跳过并打 warn */
export const QUEUE_EMAIL = "email";
/** 支付对账补偿(M21 批④,提案 §5.2):sweep 5min 收敛近过期 pending 单
 * (先查单:已付补发货/确认未付过 TTL 才关单)+ 每日 04:13 近 7 天 paid
 * 查单比对流水锚;不一致只告警不动账。并发 1 防双拍交错查单 */
export const QUEUE_PAY_RECONCILE = "pay-reconcile";
/** 优质内容发现(M25,discovery-plan.md):热词日频直拉 + B站发现周频双窗;
 * 并发 1(B站风控纪律全局串行)+ 锁 900s 覆盖双窗全词 5-10 分钟 */
export const QUEUE_DISCOVERY = "discovery";
/** 洞察加工(M34 批②,insight-plan §5):embed 高频向量回填+增量聚类 /
 * daily 日频 LLM 打标+覆盖度+快照;并发 1(同批自愈重扫语义,防双拍交错归簇)*/
export const QUEUE_INSIGHT = "insight";
/** 配图工坊拆层(M40 批 B,arch/05 §4.7):手动触发 Seedream layer_decomposition,
 * 官方 URL 24h 过期前 worker 转存站内媒体;拆层 ~75s 不占请求(请求内禁秒级任务)。
 * 并发 1:拆层是单绑定模型重调用,串行防打爆速率 */
export const QUEUE_ILLUSTRATION_STUDIO = "illustration-studio";

export const QUEUE_NAMES = [
  QUEUE_MEDIA_PROCESS,
  QUEUE_MEDIA_TRANSFER,
  QUEUE_MEDIA_AUDIT,
  QUEUE_STATS,
  QUEUE_CRAWLER,
  QUEUE_INTERPRETER,
  QUEUE_SUMMARIZER,
  QUEUE_GITHUB,
  QUEUE_COVER_GEN,
  QUEUE_SEO_BATCH,
  QUEUE_DISTRIBUTE,
  QUEUE_DB_BACKUP,
  QUEUE_EMBED,
  QUEUE_EMAIL,
  QUEUE_PAY_RECONCILE,
  QUEUE_DISCOVERY,
  QUEUE_INSIGHT,
  QUEUE_ILLUSTRATION_STUDIO,
  QUEUE_DISTRIBUTE_XHS,
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

// cron 常量唯一真相源在 lib/collect/schedules.ts(采集计划登记表;客户端组件
// 引用登记表时不得把 bullmq 拖进浏览器包,故常量不经本文件定义)。此处
// re-export 保 worker/scripts 原引用路径不变。
export {
  AGENT_SESSION_PURGE_CRON,
  COVER_TEMP_SWEEP_CRON,
  DB_BACKUP_CRON,
  DISCOVERY_BILI_CRON,
  DISCOVERY_HOTWORDS_CRON,
  EMBED_RECONCILE_CRON,
  INSIGHT_DAILY_CRON,
  INSIGHT_EMBED_CRON,
  INSIGHT_FETCH_CRON,
  JOB_RUN_PURGE_CRON,
  MEDIA_AUDIT_CRON,
  PAY_DAILY_AUDIT_CRON,
  PRICING_CRAWL_CRON,
  USAGE_LOG_PURGE_CRON,
  VISIT_LOG_PURGE_CRON,
} from "./collect/schedules";

/** crawler 队列 job name 契约(生产:tick 调度/ingest.ts/ingest-video.ts/bloggers-admin.ts;
 * 消费:worker 按 job.name 分流,crawl 为缺省路径)。改名需与 worker 同批。
 * ai-backfill(M12 批③)借 crawler 队列的 tick 生态做 AI 存量补扫调度(纯入队,轻)。 */
export const CRAWL_JOB_TICK = "tick";
export const CRAWL_JOB_SOURCE = "crawl";
export const CRAWL_JOB_VIDEO = "crawl-video";
export const CRAWL_JOB_AI_BACKFILL = "ai-backfill";

/** cover-gen 队列 job name 契约(M14 批⑥;generate 为缺省路径,agent 两工具面
 * ——编辑页 generate_post_cover 与 topic 域 generate_cover_candidates——入队)。
 * temp-sweep = hold 候选临时件日频清扫(技术债批①;改名需与 worker 同批)。 */
export const COVER_JOB_GEN = "generate";
export const COVER_JOB_TEMP_SWEEP = "temp-sweep";

/** seo-batch 队列 job name 契约(M16;batch 为缺省路径,文章管理手动触发) */
export const SEO_JOB_BATCH = "batch";

/** distribute 队列 job name 契约(M17;wechat-sync 单篇为缺省路径——手动一键/发布
 * 自动共用;wechat-batch 批量单 job 顺序逐篇)。改名需与 worker 同批。
 * wechat-copy = 复制公众号格式(M31 批④备用通道,无码点门)。 */
export const DISTRIBUTE_JOB_WECHAT = "wechat-sync";
export const DISTRIBUTE_JOB_WECHAT_BATCH = "wechat-batch";
export const DISTRIBUTE_JOB_WECHAT_COPY = "wechat-copy";

/** 贴图公众号同步(M41 渠道三 newspic 图片消息;与文章同步共用 distribute
 * 队列串行防频控)。改名需与 worker 同批。 */
export const DISTRIBUTE_JOB_PIN_WECHAT = "pin-wechat-sync";

/** stats 队列 job name 契约(flush 为缺省路径;purge 清理访问明细;
 * purge-usage-log 清理 AI 用量台账,M14 批⑦;purge-agent-session 清退
 * Drawer 会话 30 天前留档,K2.5;purge-job-run 清理任务运行台账,验收二批③) */
export const STATS_JOB_FLUSH = "flush";
export const STATS_JOB_PURGE = "purge-visit-log";
export const STATS_JOB_USAGE_PURGE = "purge-usage-log";
export const STATS_JOB_AGENT_PURGE = "purge-agent-session";
export const STATS_JOB_RUN_PURGE = "purge-job-run";

/** db-backup 队列 job name 契约(run 为缺省路径;手动触发 scripts/ops/db-backup-trigger.ts 同名) */
export const DB_BACKUP_JOB_RUN = "run";

/** embed-content 队列 job name 契约(reconcile 为缺省路径;手动触发
 * scripts/ops/embed-reconcile-trigger.ts 同名,回填与日常对账同一入口) */
export const EMBED_JOB_RECONCILE = "reconcile";

/** email 队列 job name 契约(send 为缺省路径;M21 批⓪) */
export const EMAIL_JOB_SEND = "send";

/** pay-reconcile 队列 job name 契约(sweep 为缺省路径;daily-audit 日对账;M21 批④) */
export const PAY_JOB_SWEEP = "sweep";
export const PAY_JOB_DAILY_AUDIT = "daily-audit";

/** github 队列 job name 契约(生产:tick 调度/sync.ts/repos-admin.ts;消费:worker 按
 * job.name 分流,sync 为缺省路径)。改名需与 worker 同批。 */
export const GITHUB_JOB_TICK = "tick";
export const GITHUB_JOB_SYNC = "sync";

/** discovery 队列 job name 契约(M25:热词日频 + B站发现周频两 repeatable;
 * 手动触发 /api/discovery/trigger 入同名一次性 job,jobId 带 manual 前缀)。
 * 改名需与 worker 同批。 */
export const DISCOVERY_JOB_HOTWORDS = "discovery-hotwords";
export const DISCOVERY_JOB_BILI = "discovery-bili";

/** insight 队列 job name 契约(M34 批②;embed 为缺省路径——手动触发
 * scripts/ops 同名一次性 job 可复用;daily=日频打标批。改名需与 worker 同批) */
export const INSIGHT_JOB_EMBED = "embed";
export const INSIGHT_JOB_DAILY = "daily";
export const INSIGHT_JOB_FETCH = "fetch";

/** illustration-studio 队列 job name 契约(M40 批 B;decompose 为缺省路径——
 * 拆层运行首次触发与改字后手动重拆同一入口,jobId 锚 groupId 天然唯一)。
 * 改名需与 worker 同批。generate = 直出生成(M41:工坊「新建配图」/组装台
 * 「AI 生成贴图」,prompt→文生图→根版本→可选回填贴图)。edit = 三回路交互
 * 编辑(M47 批 A 自同步路由队列化,候选轮询制)。 */
export const ILLUSTRATION_JOB_DECOMPOSE = "decompose";
export const ILLUSTRATION_JOB_GENERATE = "generate";
export const ILLUSTRATION_JOB_EDIT = "edit";

export function bullConnection(): IORedis {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: bullConnection() as unknown as ConnectionOptions });
    queues.set(name, q);
  }
  return q;
}
