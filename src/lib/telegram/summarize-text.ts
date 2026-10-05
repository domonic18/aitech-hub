/**
 * 文字资讯解读(M12 批③,arch/02 §3.1 增补;summarize 角色首个消费方):
 * summarizer 队列——标题 + RSS 摘要(短于 80 字时抓原文粗提取:正则剥标签截
 * 4k 字,10s 超时失败静默降级)→ LLM 一句话中心思想 + 关键词 → telegram.ai_*
 * 列落库(ai_summary=中心思想、ai_points=关键词 JSON)。版权面干净:只吃公开
 * RSS 元数据与原文公开正文,无转写/无水印流。落库形状与视频共用 ai_* 列组
 * (ai_topic 留空),读侧 PublicTelegramItem.ai 单形状投影。
 * summarize 未绑定是运营态:不标条目失败,补扫 tick 在绑定后自然消化存量。
 */
import { chatJsonTask } from "../ai/chat-json-task";
import { AI_PURPOSE_SUMMARIZE } from "../ai/constants";
import { AiClientError } from "../ai/errors";
import { getRoleDailyMax, resolveAiModel, type ResolvedAiModel } from "../ai/resolver";
import {
  buildSummarizePrompt,
  parseSummarizeResult,
  type SummarizeResult,
} from "../ai/summarize-result";
import { prisma } from "../db";
import { logger } from "../logger";
import { getQueue, QUEUE_SUMMARIZER } from "../queue";

import { aiJobOpts, markAiFailed, markAiPendingAndEnqueue } from "./ai-shared";
import {
  TELEGRAM_AI_DONE,
  TELEGRAM_AI_PENDING,
  TELEGRAM_AI_PROCESSING,
  TELEGRAM_MEDIA_TEXT,
} from "./constants";
import { stripHtml } from "./normalize";
import { countTodayAiDone } from "./spider-queries";

/** summarize job data:无过境字段,输入(标题/摘要/外链)worker 内从库读 */
export interface SummarizeJobData {
  /** telegram.id(BigInt → string 出口惯例) */
  telegramId: string;
}

/** summarizer 队列 job name(入队与 worker 消费同源;改名需与 worker/index.ts 同批) */
export const SUMMARIZE_JOB_NAME = "summarize-text";

/** job 幂等锚(连字符分隔,BullMQ 拒绝冒号) */
export function summarizeJobId(telegramId: string, suffix?: string): string {
  return `summarize-${telegramId}${suffix ? `-${suffix}` : ""}`;
}

/** 摘要就绪 = summarize 角色已绑定可用模型(未配置是运营态,不标条目失败) */
export async function isSummarizeReady(): Promise<boolean> {
  return (await resolveAiModel(AI_PURPOSE_SUMMARIZE)) !== null;
}

/** 入队摘要(attempts 兜网络层,LLM 解析重试在管道内) */
export async function enqueueSummarize(data: SummarizeJobData): Promise<void> {
  await getQueue(QUEUE_SUMMARIZER).add(
    SUMMARIZE_JOB_NAME,
    data,
    aiJobOpts({ jobId: summarizeJobId(data.telegramId) }),
  );
}

/** 「先标 pending → 入队,失败回滚 null」(采集钩子与补扫共用) */
export async function markPendingAndEnqueueSummarize(telegramId: bigint): Promise<void> {
  await markAiPendingAndEnqueue(telegramId, () =>
    enqueueSummarize({ telegramId: telegramId.toString() }),
  );
}

export interface SummarizeOutcome {
  telegramId: string;
  status:
    | "done"
    | "failed"
    | "skipped_not_found"
    | "skipped_done"
    | "skipped_not_ready"
    | "deferred_quota";
  error?: string;
}

const QUOTA_DEFER_MS = 30 * 60_000;
/** 摘要短于此字数时尝试抓原文补充输入 */
const SHORT_SUMMARY_CHARS = 80;
const FETCH_TIMEOUT_MS = 10_000;
/** 原文粗提取上限(先截 HTML 再剥标签,防超大页面撑内存) */
const FETCH_HTML_MAX = 200_000;
const CONTENT_MAX_CHARS = 4000;

/** 原文粗提取(与 adapters/rss 同款 UA 标识):任何失败静默返回 null 降级摘要,
 * 不重试不标败——外站反爬是常态,不值得烧 attempts。 */
async function fetchArticleText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "aitech-hub-crawler/0.1 (+https://17aitech.com)" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, FETCH_HTML_MAX);
    const text = stripHtml(html).slice(0, CONTENT_MAX_CHARS);
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/** worker「summarize-text」job 入口(状态机分支语义见 SummarizeOutcome) */
export async function summarizeTextJob(data: SummarizeJobData): Promise<SummarizeOutcome> {
  const id = BigInt(data.telegramId);
  const row = await prisma.telegram.findUnique({
    where: { id },
    select: { id: true, title: true, summary: true, url: true, aiStatus: true },
  });
  if (!row) return { telegramId: data.telegramId, status: "skipped_not_found" };
  if (row.aiStatus === TELEGRAM_AI_DONE) {
    return { telegramId: data.telegramId, status: "skipped_done" };
  }

  const model = await resolveAiModel(AI_PURPOSE_SUMMARIZE);
  if (model === null) {
    // 未配置是运营态:aiStatus 不动,仅落提示(绑定后经补扫 tick 自然重试)
    await prisma.telegram.update({
      where: { id },
      data: { lastAiError: "摘要未启用:summarize 模型未配置" },
    });
    return { telegramId: data.telegramId, status: "skipped_not_ready" };
  }

  // 日配额(后台 summarize 绑定可配,缺省 100):满则延迟重投顺延,绝不 throw / 标败
  if (
    (await countTodayAiDone(TELEGRAM_MEDIA_TEXT)) >= (await getRoleDailyMax(AI_PURPOSE_SUMMARIZE))
  ) {
    await getQueue(QUEUE_SUMMARIZER).add(
      SUMMARIZE_JOB_NAME,
      data,
      aiJobOpts({
        jobId: summarizeJobId(data.telegramId, `r${Date.now()}`),
        delayMs: QUOTA_DEFER_MS,
      }),
    );
    logger.warn({ event: "summarize.text.quota_deferred", telegramId: data.telegramId });
    return { telegramId: data.telegramId, status: "deferred_quota" };
  }

  await prisma.telegram.update({
    where: { id },
    data: { aiStatus: TELEGRAM_AI_PROCESSING, lastAiError: null },
  });

  // 输入组装:摘要过短(<80 字)时抓原文粗提取;失败静默降级仅用标题+摘要
  const title = row.title ?? "";
  const baseSummary = row.summary ?? "";
  let content: string | null = null;
  if (baseSummary.length < SHORT_SUMMARY_CHARS && row.url) {
    content = await fetchArticleText(row.url);
  }
  const prompt = buildSummarizePrompt({ title, summary: baseSummary, content });

  let result: SummarizeResult;
  try {
    result = await runSummarizeLlm(model, prompt.system, prompt.user);
  } catch (err) {
    await markAiFailed(id, err);
    // 解析类失败重试无益不烧 attempts;网络/HTTP/超时交给 BullMQ attempts
    if (err instanceof AiClientError && err.kind === "business") {
      return { telegramId: data.telegramId, status: "failed", error: err.message };
    }
    throw err;
  }

  await prisma.telegram.update({
    where: { id },
    data: {
      aiStatus: TELEGRAM_AI_DONE,
      aiTopic: null,
      aiSummary: result.summary,
      aiPoints: result.keywords,
      aiRanAt: new Date(),
      lastAiError: null,
    },
  });
  logger.info({
    event: "summarize.text.done",
    telegramId: data.telegramId,
    keywords: result.keywords.length,
  });
  return { telegramId: data.telegramId, status: "done" };
}

/** LLM 调用 + 契约解析(解析重试在 chatJsonTask;具名一层便于堆栈可读) */
function runSummarizeLlm(
  model: ResolvedAiModel,
  system: string,
  user: string,
): Promise<SummarizeResult> {
  return chatJsonTask(model, parseSummarizeResult, system, user);
}
