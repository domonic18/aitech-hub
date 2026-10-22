/**
 * 各队列处理器映射(worker/index 引导消费):按 job.name 分流的分支语义全部
 * 收口在本表;未到里程碑的队列保持显式失败,避免静默吞任务。编排细节在各自
 * lib 服务内,这里只做分发与 job 级汇总事件。
 */
import type { Processor } from "bullmq";

import {
  COVER_JOB_TEMP_SWEEP,
  CRAWL_JOB_AI_BACKFILL,
  CRAWL_JOB_TICK,
  CRAWL_JOB_VIDEO,
  DISCOVERY_JOB_BILI,
  DISCOVERY_JOB_HOTWORDS,
  DISTRIBUTE_JOB_WECHAT_BATCH,
  DISTRIBUTE_JOB_WECHAT_COPY,
  GITHUB_JOB_TICK,
  INSIGHT_JOB_DAILY,
  INSIGHT_JOB_EMBED,
  INSIGHT_JOB_FETCH,
  PAY_JOB_DAILY_AUDIT,
  QUEUE_COVER_GEN,
  QUEUE_CRAWLER,
  QUEUE_DB_BACKUP,
  QUEUE_DISCOVERY,
  QUEUE_DISTRIBUTE,
  QUEUE_EMBED,
  QUEUE_EMAIL,
  QUEUE_GITHUB,
  QUEUE_INSIGHT,
  QUEUE_ILLUSTRATION_STUDIO,
  QUEUE_INTERPRETER,
  QUEUE_MEDIA_AUDIT,
  QUEUE_MEDIA_PROCESS,
  QUEUE_MEDIA_TRANSFER,
  QUEUE_PAY_RECONCILE,
  QUEUE_SEO_BATCH,
  QUEUE_STATS,
  QUEUE_SUMMARIZER,
  STATS_JOB_AGENT_PURGE,
  STATS_JOB_PURGE,
  STATS_JOB_RUN_PURGE,
  STATS_JOB_USAGE_PURGE,
} from "../src/lib/queue";
import { purgeJobRuns } from "../src/lib/jobs/runlog";
import { DISCOVERY_MAX_WORDS_PER_ROUND } from "../src/lib/discovery/constants";
import { runBiliDiscovery } from "../src/lib/discovery/discover";
import { runHotwordsDiscovery } from "../src/lib/discovery/hotwords";
import { flushStatsBuffer } from "../src/lib/stats/flush";
import { purgeClickLogs } from "../src/lib/stats/clicks";
import { purgeSearchLogs, purgeVisitLogs } from "../src/lib/stats/service";
import { purgeAiUsageOlderThan } from "../src/lib/ai/usage-log";
import { purgeAgentSessions, purgeExpiredGuestThreads } from "../src/lib/agent/purge";
import { syncDueRepos, syncGithubRepo } from "../src/lib/github/sync";
import { backfillAiPending } from "../src/lib/telegram/ai-backfill";
import { crawlDueSources, crawlSource } from "../src/lib/telegram/ingest";
import { crawlVideoAccount, enqueueDueVideoAccounts } from "../src/lib/telegram/ingest-video";
import {
  coverGenJob,
  sweepStaleCoverTemp,
  type CoverGenJobData,
} from "../src/lib/ai/cover-generate";
import {
  illustrationDecomposeJob,
  type DecomposeJobData,
} from "../src/lib/ai/illustration-decompose";
import { seoBatchJob, type SeoBatchJobData } from "../src/lib/ai/seo-batch";
import {
  type WechatBatchJobData,
  type WechatCopyJobData,
  type WechatSyncJobData,
} from "../src/lib/distribute/wechat-sync";
import { wechatCopyJob } from "../src/lib/distribute/wechat-copy-run";
import { wechatBatchJob, wechatSyncJob } from "../src/lib/distribute/wechat-sync-run";
import { interpretVideoJob, type InterpretJobData } from "../src/lib/telegram/interpret-video";
import { summarizeTextJob, type SummarizeJobData } from "../src/lib/telegram/summarize-text";
import { processMediaJob, transferMediaJob } from "./media";
import { runAudit } from "../src/lib/media/audit";
import { dbBackupJob } from "../src/lib/backup/db-backup";
import { type EmailJobData, sendMail } from "../src/lib/email/mailer";
import { reconcileEmbeddings } from "../src/lib/search/embed-reconcile";
import { runInsightEmbedBatch } from "../src/lib/insight/embed";
import { runHotlistFetch } from "../src/lib/insight/hotlist/run";
import { runInsightDaily } from "../src/lib/insight/daily";
import { dailyAuditOrders, sweepExpiredOrders } from "../src/lib/pay/reconcile";

export const PROCESSORS: Record<string, Processor> = {
  [QUEUE_MEDIA_PROCESS]: (job) => processMediaJob(job),
  [QUEUE_MEDIA_TRANSFER]: (job) => transferMediaJob(job),
  [QUEUE_MEDIA_AUDIT]: async () => {
    const summary = await runAudit();
    console.log(JSON.stringify({ event: "media.audit", ...summary }));
    return summary;
  },
  [QUEUE_STATS]: async (job) => {
    // 明细保留期清理(M10 批⑥ 访问 7 天;2026-10-06 搜索词 180 天;M28 批① 点击 180 天;
    // 与 flush 同队列按 job.name 分流)
    if (job.name === STATS_JOB_PURGE) {
      const visitRemoved = await purgeVisitLogs();
      if (visitRemoved > 0) {
        console.log(JSON.stringify({ event: "stats.visit_log.purge", removed: visitRemoved }));
      }
      const searchRemoved = await purgeSearchLogs();
      if (searchRemoved > 0) {
        console.log(JSON.stringify({ event: "stats.search_log.purge", removed: searchRemoved }));
      }
      const clickRemoved = await purgeClickLogs();
      if (clickRemoved > 0) {
        console.log(JSON.stringify({ event: "stats.click_log.purge", removed: clickRemoved }));
      }
      return { removed: visitRemoved + searchRemoved + clickRemoved };
    }
    // AI 用量台账 90 天保留期清理(M14 批⑦;与手动清理同口径 usage-log.ts)
    if (job.name === STATS_JOB_USAGE_PURGE) {
      const removed = await purgeAiUsageOlderThan();
      if (removed > 0) {
        console.log(JSON.stringify({ event: "ai_usage.purge", removed }));
      }
      return { removed };
    }
    // Drawer 会话清退(K2.5 member 30 天 + K2.6 游客 TTL 键消失;checkpoint 残留由下轮再扫)
    if (job.name === STATS_JOB_AGENT_PURGE) {
      const removed = await purgeAgentSessions();
      if (removed > 0) {
        console.log(JSON.stringify({ event: "agent.session.purge", removed }));
      }
      const guestRemoved = await purgeExpiredGuestThreads();
      if (guestRemoved > 0) {
        console.log(JSON.stringify({ event: "agent.guest_thread.purge", removed: guestRemoved }));
      }
      return { removed, guestRemoved };
    }
    // 任务运行台账 30 天保留期清理 + 崩溃残留代收口(验收二批③)
    if (job.name === STATS_JOB_RUN_PURGE) {
      const summary = await purgeJobRuns();
      if (summary.purged > 0 || summary.crashed > 0) {
        console.log(JSON.stringify({ event: "jobrun.purge", ...summary }));
      }
      return summary;
    }
    const summary = await flushStatsBuffer();
    if (summary.keysFlushed > 0) {
      console.log(JSON.stringify({ event: "stats.flush", ...summary }));
    }
    return summary;
  },
  // tick(每分钟)、crawl(单渠道)、crawl-video(单博主)、ai-backfill(5min)共用队列,按 job.name 分流
  [QUEUE_CRAWLER]: async (job) => {
    if (job.name === CRAWL_JOB_TICK) {
      const summary = await crawlDueSources();
      // 同拍扫视频博主(平台行不调度,social_account 才是调度主体;M8)
      const video = await enqueueDueVideoAccounts();
      const due = summary.due + video.due;
      if (due > 0) {
        console.log(JSON.stringify({ event: "crawler.tick", ...summary, videoDue: video.due }));
      }
      return { ...summary, videoDue: video.due };
    }
    if (job.name === CRAWL_JOB_AI_BACKFILL) {
      // AI 存量补扫(M12 批③):未解读条目分流入 interpret/summarize 队列
      const summary = await backfillAiPending();
      if (summary.video > 0 || summary.text > 0) {
        console.log(JSON.stringify({ event: "ai.backfill", ...summary }));
      }
      return summary;
    }
    if (job.name === CRAWL_JOB_VIDEO) {
      // data.backfill 由手动回填路由置真(批⑧);旧 worker 收到退化为常规增量(良性)
      const summary = await crawlVideoAccount(Number(job.data.accountId), {
        backfill: job.data.backfill === true,
      });
      console.log(JSON.stringify({ event: "crawler.video.crawl", ...summary }));
      return summary;
    }
    const summary = await crawlSource(Number(job.data.sourceId));
    console.log(JSON.stringify({ event: "crawler.crawl", ...summary }));
    return summary;
  },
  // 视频解读(M9):下载→抽轨→ASR→LLM;分支语义在 interpretVideoJob 内收敛
  [QUEUE_INTERPRETER]: (job) => interpretVideoJob(job.data as InterpretJobData),
  // 文字资讯轻解读(M12 批③):中心思想 + 关键词,LLM 网络调用为主(默认并发 2)
  [QUEUE_SUMMARIZER]: (job) => summarizeTextJob(job.data as SummarizeJobData),
  // 文生图封面(M14 批⑥):云厂商生图 10-30s,按张计费不自动重试(attempts=1 入队侧钉)
  [QUEUE_COVER_GEN]: async (job) => {
    // temp-sweep:hold 候选孤儿目录日频清扫(技术债批①);generate 为缺省路径
    if (job.name === COVER_JOB_TEMP_SWEEP) {
      const r = await sweepStaleCoverTemp();
      console.log(JSON.stringify({ event: "cover.temp_sweep_job", ...r }));
      return r;
    }
    return coverGenJob(job.data as CoverGenJobData);
  },
  // 批量 SEO 补全(M16 问题8,仅补空缺):单批次 job 顺序逐篇 LLM 调用,进度逐篇上报
  [QUEUE_SEO_BATCH]: (job) =>
    seoBatchJob(job.data as SeoBatchJobData, (p) => job.updateProgress(p)),
  // GitHub 项目同步(二期③/M11):tick(5min)扫到期白名单仓逐仓入队;sync 为缺省路径
  [QUEUE_GITHUB]: async (job) => {
    if (job.name === GITHUB_JOB_TICK) {
      const summary = await syncDueRepos();
      if (summary.due > 0) {
        console.log(JSON.stringify({ event: "github.tick", ...summary }));
      }
      return summary;
    }
    const summary = await syncGithubRepo(Number(job.data.repoId));
    console.log(JSON.stringify({ event: "github.sync", ...summary }));
    return summary;
  },
  // 数据库每日备份(M19 批②):pg_dump -Fc → 备份桶;结果事件在 job 内落日志
  [QUEUE_DB_BACKUP]: async () => {
    const r = await dbBackupJob();
    console.log(
      JSON.stringify({
        event: "db.backup_job_done",
        key: r.key,
        sizeBytes: r.sizeBytes,
        ms: r.durationMs,
      }),
    );
    return r;
  },
  // embedding 对账(M20 批②):扫 stale 三域 → 批 embed → upsert;汇总事件在 reconcile 内落日志
  [QUEUE_EMBED]: async () => {
    const r = await reconcileEmbeddings();
    if (r.embedded > 0 || r.failed > 0 || r.cleaned > 0 || r.skipped) {
      console.log(JSON.stringify({ event: "embed.reconcile_job", ...r }));
    }
    return r;
  },
  // 事务邮件(M21 批⓪,D1 邮箱通道):SMTP 未配置显式 skipped(dev 兜底;生产必配);
  // 日志只记事件与主题,收件人不落日志(PII)
  [QUEUE_EMAIL]: async (job) => {
    const data = job.data as EmailJobData;
    const { skipped } = await sendMail(data);
    console.log(
      JSON.stringify({ event: skipped ? "email.skipped" : "email.sent", subject: data.subject }),
    );
    return { skipped };
  },
  // 公众号草稿同步(M17):wechat-sync 单篇为缺省路径(一键/发布自动共用);wechat-batch 批量;
  // wechat-copy 复制公众号格式(M31 批④备用通道,无码点门不落库)
  [QUEUE_DISTRIBUTE]: async (job) => {
    if (job.name === DISTRIBUTE_JOB_WECHAT_BATCH) {
      const progress = await wechatBatchJob(job.data as WechatBatchJobData, (p) =>
        job.updateProgress(p),
      );
      console.log(JSON.stringify({ event: "wechat.batch_result", ...progress }));
      return progress;
    }
    if (job.name === DISTRIBUTE_JOB_WECHAT_COPY) {
      const r = await wechatCopyJob(job.data as WechatCopyJobData);
      console.log(JSON.stringify({ event: "wechat.copy_result", postId: r.postId, ok: r.ok }));
      return r;
    }
    const r = await wechatSyncJob(job.data as WechatSyncJobData);
    console.log(
      JSON.stringify({
        event: "wechat.sync_result",
        postId: r.postId,
        ok: r.ok,
        mediaId: r.mediaId ?? null,
      }),
    );
    return r;
  },
  // 支付对账(M21 批④,§5.2):sweep 5min 收敛近过期 pending(先查单:已付
  // 补发/确认未付过 TTL 才关单);daily-audit 每日 04:13 paid 单流水锚比对。
  // 明细事件(reconcile_error/mismatch 等)在服务内落日志,这里只报汇总
  [QUEUE_PAY_RECONCILE]: async (job) => {
    if (job.name === PAY_JOB_DAILY_AUDIT) {
      const r = await dailyAuditOrders();
      console.log(JSON.stringify({ event: "pay.reconcile_daily_audit", ...r }));
      return r;
    }
    const r = await sweepExpiredOrders();
    if (r.scanned > 0 || r.errors > 0) {
      console.log(JSON.stringify({ event: "pay.reconcile_sweep", ...r }));
    }
    return r;
  },
  // 优质内容发现(M25):hotwords 日频 / B站双窗周频按 job.name 分流;风控纪律
  // (串行/间隔/退避)在服务内固化,这里只报 job 级汇总。未知 job 显式抛错
  [QUEUE_DISCOVERY]: async (job) => {
    if (job.name === DISCOVERY_JOB_BILI) {
      const r = await runBiliDiscovery(DISCOVERY_MAX_WORDS_PER_ROUND);
      console.log(JSON.stringify({ event: "discovery.bili_job", ...r }));
      return r;
    }
    if (job.name === DISCOVERY_JOB_HOTWORDS) {
      const r = await runHotwordsDiscovery(DISCOVERY_MAX_WORDS_PER_ROUND);
      console.log(JSON.stringify({ event: "discovery.hotwords_job", ...r }));
      return r;
    }
    throw new Error(`未知 discovery job:${job.name}`);
  },
  // 洞察加工(M34 批②):embed=向量回填+增量聚类(15min,向量调用为主);
  // daily=LLM 打标+覆盖度+评分快照(日频)。LLM/向量外呼在服务内收敛,
  // 未绑定模型服务侧自降级,这里只报 job 级汇总。未知 job 显式抛错
  [QUEUE_INSIGHT]: async (job) => {
    if (job.name === INSIGHT_JOB_DAILY) {
      const r = await runInsightDaily();
      console.log(JSON.stringify({ event: "insight.daily_job", ...r }));
      return r;
    }
    if (job.name === INSIGHT_JOB_EMBED) {
      const r = await runInsightEmbedBatch();
      if (r.embedded > 0 || r.joined > 0 || r.created > 0 || r.failed > 0) {
        console.log(JSON.stringify({ event: "insight.embed_job", ...r }));
      }
      return r;
    }
    if (job.name === INSIGHT_JOB_FETCH) {
      const r = await runHotlistFetch();
      console.log(JSON.stringify({ event: "insight.hotlist_job", ...r }));
      return r;
    }
    throw new Error(`未知 insight job:${job.name}`);
  },
  // 配图工坊拆层(M40 批 B):手动触发,单 job ~75s 官方拆层 + 逐层转存落库;
  // 失败落图层组 failed 行(attempts=1 生图计费不自动重试,入队侧钉)
  [QUEUE_ILLUSTRATION_STUDIO]: (job) => illustrationDecomposeJob(job.data as DecomposeJobData),
};
