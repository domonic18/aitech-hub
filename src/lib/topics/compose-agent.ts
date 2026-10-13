/**
 * 专题合成 agent 化(M27 批③,1276 验收反馈「文章撰写是 agent 智能生产过程」):
 * BullMQ 异步多步管线——①选题角度择优(2~3 候选带钩子自选最优)→ ②固定结构
 * 起草(批① STRUCTURE_SPEC)→ ③审稿清单自检 → ④按问题修订(自检过跳过);
 * 每步独立 chatJsonTask,role=compose 台账逐次落行。确定性代码编排(deepagents
 * 工具环无增益:素材全在上下文,无检索需求),任一管线步失败自动降级单调用
 * (composeTopicDraft)保出稿,降级诚实记 fallback 供 UI 提示。重合成 409 确认
 * 保留在路由层入队前;落稿锚定走共享核 finalizeCompose。
 */
import { AI_PURPOSE_COMPOSE } from "../ai/constants";
import { AiClientError } from "../ai/errors";
import { chatJsonTask } from "../ai/chat-json-task";
import type { ResolvedAiModel } from "../ai/resolver";
import { prisma } from "../db";
import { logger } from "../logger";
import { getQueue, QUEUE_TOPIC_COMPOSE, TOPIC_COMPOSE_JOB } from "../queue";
import { needsRecomposeConfirm } from "./compose";
import { getTopic, TopicError } from "./repo";
import {
  ANGLE_SPEC,
  buildComposePrompt,
  buildMaterialSection,
  CHECKLIST_SPEC,
  parseAngle,
  parseCheck,
  parseComposeResult,
  REVISE_SYSTEM,
  type ComposeMaterialBlock,
  type ComposeResult,
} from "./compose-prompt";
import {
  buildComposeBlocks,
  COMPOSE_MAX_TOKENS,
  composeTopicDraft,
  finalizeCompose,
  listRecentPublishedTitles,
  requireComposeModel,
  transferCoverOrNull,
  type ComposeOutcome,
} from "./compose";

// ── 进度/结果/状态契约(路由轮询与 worker 上报共用)────────────

/** 进度快照(worker updateProgress 上报;fallback=管线降级单调用,UI 提示用) */
export interface TopicComposeProgress {
  step: number;
  total: number;
  label: string;
  fallback?: boolean;
}

/** job returnvalue(done 终态返回;postId 串形态直供前端跳转) */
export interface TopicComposeResult {
  postId: string;
  postTitle: string;
  recomposed: boolean;
  coverPath: string | null;
  fallback: boolean;
}

export type TopicComposeState =
  | { state: "idle"; progress: null; result: null; error: null }
  | {
      state: "queued" | "running";
      progress: TopicComposeProgress | null;
      result: null;
      error: null;
    }
  | { state: "done"; progress: null; result: TopicComposeResult; error: null }
  | { state: "failed"; progress: null; result: null; error: string };

const COMPOSE_STEP_TOTAL = 4;

/** jobId 确定性形态(bigint 模板插值即 toString);轮询查询与并发防重共用 */
const composeJobId = (topicId: bigint): string => `topic-compose-${topicId}`;

/**
 * 合成资格预检(M27 批④自 POST 路由上提,路由与 agent 工具共用同一真相源):
 * 素材非空 → 重合成保护判定(关联文档被人工编辑过且未带 confirm → needConfirm,
 * 软删弃锚直接新建)。
 */
export async function checkComposeEligibility(
  topicId: bigint,
  confirm: boolean,
): Promise<{ ok: true } | { ok: false; message: string; needConfirm?: boolean }> {
  const topic = await getTopic(topicId);
  if (topic.items.length === 0) {
    return { ok: false, message: "尚未挂载素材——先挂 2~3 条解读/文章再合成" };
  }
  const linked =
    topic.linkedPostId !== null
      ? await prisma.post.findUnique({
          where: { id: topic.linkedPostId },
          select: { status: true, updatedAt: true },
        })
      : null;
  if (!confirm && linked && linked.status !== "deleted" && needsRecomposeConfirm(topic, linked)) {
    return {
      ok: false,
      message: "关联文档在合成后被人工编辑过,重合成将覆盖这些改动——确认覆盖吗?",
      needConfirm: true,
    };
  }
  return { ok: true };
}

/**
 * 入队(路由与 agent 工具消费):绑定缺失先于人话 400(requireComposeModel);
 * 同专题 active/waiting 拒重 409;completed/failed 旧 job 先删再入——确定性
 * jobId 在 BullMQ 是去重键,removeOnComplete 保留窗口内不清掉会把重合成静默
 * 丢弃。attempts=1:管线内部已带降级,BullMQ 重试只会整链翻倍烧 token,失败
 * 交用户重按。
 */
export async function enqueueTopicCompose(topicId: bigint): Promise<{ jobId: string }> {
  await requireComposeModel();
  const jobId = composeJobId(topicId);
  const queue = getQueue(QUEUE_TOPIC_COMPOSE);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const st = await existing.getState();
    if (st === "active" || st === "waiting" || st === "delayed") {
      throw new TopicError("conflict", "该专题正在合成中,请等待完成后再试");
    }
    await existing.remove();
  }
  await queue.add(
    TOPIC_COMPOSE_JOB,
    { topicId: topicId.toString() },
    { jobId, attempts: 1, removeOnComplete: 50, removeOnFail: 50 },
  );
  logger.info({ event: "topic.compose_enqueued", topicId: topicId.toString(), jobId });
  return { jobId };
}

/** 轮询查询(路由 GET 消费):无 job=idle;completed/failed 读 returnvalue/failedReason */
export async function getTopicComposeState(topicId: bigint): Promise<TopicComposeState> {
  const idle = { state: "idle" as const, progress: null, result: null, error: null };
  const job = await getQueue(QUEUE_TOPIC_COMPOSE).getJob(composeJobId(topicId));
  if (!job) return idle;
  const st = await job.getState();
  if (st === "completed") {
    return {
      state: "done",
      progress: null,
      result: job.returnvalue as TopicComposeResult,
      error: null,
    };
  }
  if (st === "failed") {
    return {
      state: "failed",
      progress: null,
      result: null,
      error: (job.failedReason ?? "合成失败").slice(0, 300),
    };
  }
  if (st === "active" || st === "waiting" || st === "delayed") {
    return {
      state: st === "active" ? "running" : "queued",
      progress: (job.progress as TopicComposeProgress | null) ?? null,
      result: null,
      error: null,
    };
  }
  return idle;
}

// ── 管线步骤(纯拼装 + chatJsonTask;契约与 prompt 在 compose-prompt)────

/** 步① 选题角度择优:2~3 候选自选最优(防重复选题 + 钩子前置打磨) */
async function pickAngle(
  model: ResolvedAiModel,
  topicTitle: string,
  materialsSection: string,
  recentTitles: string[],
): Promise<{ title: string; hook: string }> {
  const user = [
    `专题:${topicTitle}`,
    "——素材库——",
    materialsSection,
    recentTitles.length > 0
      ? `——近期已发布文章标题(选题/表述避免重复)——\n${recentTitles.map((t) => `- ${t}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const r = await chatJsonTask(model, parseAngle, ANGLE_SPEC, user, AI_PURPOSE_COMPOSE, {
    maxTokens: 2000,
  });
  const chosen = r.candidates[r.chosen - 1];
  return { title: chosen.title, hook: chosen.hook };
}

/** 步② 起草:批①固定结构 prompt + 已定角度注入(遵循切入不另起炉灶) */
async function draftWithAngle(
  model: ResolvedAiModel,
  topicTitle: string,
  positioning: string | null,
  materialsSection: string,
  recentTitles: string[],
  angle: { title: string; hook: string },
): Promise<ComposeResult> {
  const p = buildComposePrompt({ topicTitle, positioning, materialsSection, recentTitles });
  const user = `${p.user}\n\n——已定选题角度(遵循此切入起草,标题向它靠拢,开头钩子以此为准)——\n标题方向:${angle.title}\n开头钩子:${angle.hook}`;
  return chatJsonTask(model, parseComposeResult, p.system, user, AI_PURPOSE_COMPOSE, {
    maxTokens: COMPOSE_MAX_TOKENS,
  });
}

/** 步③ 自检:审稿清单核对(!pass 但无 issue 视为通过——无从着手不空转) */
async function selfCheck(
  model: ResolvedAiModel,
  materialsSection: string,
  draft: ComposeResult,
): Promise<{ pass: boolean; issues: string[] }> {
  const user = [
    "——素材库(事实核对参照)——",
    materialsSection,
    "——待审文章——",
    `标题:${draft.title}`,
    `正文:\n${draft.contentMd}`,
  ].join("\n");
  const r = await chatJsonTask(model, parseCheck, CHECKLIST_SPEC, user, AI_PURPOSE_COMPOSE, {
    maxTokens: 2000,
  });
  return { pass: r.pass || r.issues.length === 0, issues: r.issues };
}

/** 步④ 修订:只修清单问题;失败上抛由调用方保底用初稿 */
async function reviseDraft(
  model: ResolvedAiModel,
  draft: ComposeResult,
  issues: string[],
): Promise<ComposeResult> {
  const user = [
    `原标题:${draft.title}`,
    `原摘要:${draft.excerpt}`,
    `原正文:\n${draft.contentMd}`,
    "——审稿问题清单——",
    issues.map((s, i) => `${i + 1}. ${s}`).join("\n"),
  ].join("\n");
  return chatJsonTask(model, parseComposeResult, REVISE_SYSTEM, user, AI_PURPOSE_COMPOSE, {
    maxTokens: COMPOSE_MAX_TOKENS,
  });
}

// ── worker 消费入口 ────────────────────────────────────────

/**
 * 合成 job(worker 消费):四步管线,任一步 AiClientError(网络/超时/解析终败)
 * → 自动降级单调用保出稿;修订步失败保底用初稿(自检 best effort,人工定稿兜底)。
 * 封面转存与落稿锚定走共享核,与单调用形态完全一致。
 */
export async function topicComposeJob(
  data: { topicId: string },
  onProgress?: (p: TopicComposeProgress) => Promise<void>,
): Promise<TopicComposeResult> {
  const topic = await getTopic(BigInt(data.topicId));
  if (topic.items.length === 0) throw new Error("专题无素材,先挂载 2~3 条解读/文章再合成");
  const model = await requireComposeModel();
  const blocks = await buildComposeBlocks(topic);
  const materialsSection = buildMaterialSection(blocks);
  const recentTitles = await listRecentPublishedTitles();
  const report = (step: number, label: string): Promise<void> =>
    onProgress?.({ step, total: COMPOSE_STEP_TOTAL, label }) ?? Promise.resolve();
  const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  let draft: ComposeResult;
  try {
    await report(1, "选题角度择优");
    const angle = await pickAngle(model, topic.title, materialsSection, recentTitles);
    await report(2, "按固定结构起草");
    draft = await draftWithAngle(
      model,
      topic.title,
      topic.positioning,
      materialsSection,
      recentTitles,
      angle,
    );
    await report(3, "审稿清单自检");
    const check = await selfCheck(model, materialsSection, draft);
    if (check.pass) {
      await report(4, "自检通过,定稿");
      return await persist(topic, blocks, draft, false);
    }
    await report(4, "按自检问题修订");
    const revised = await reviseDraft(model, draft, check.issues).catch((e: unknown) => {
      logger.warn({
        event: "topic.compose_revise_failed",
        topicId: data.topicId,
        error: errMsg(e),
      });
      return draft; // 修订失败保底用初稿(人工编辑定稿兜底)
    });
    return await persist(topic, blocks, revised, false);
  } catch (e) {
    if (!(e instanceof AiClientError)) throw e; // 非管线 LLM 失败(素材/落稿等)原样上抛
    logger.warn({
      event: "topic.compose_pipeline_fallback",
      topicId: data.topicId,
      error: e.message,
    });
    await onProgress?.({ step: 1, total: 1, label: "管线降级:单调用合成中", fallback: true });
    // 降级走单调用完整路径(自带落稿锚定),直接序列化——不得再过 persist 二次落稿
    return toJobResult(await composeTopicDraft(topic), true);
  }
}

/** ComposeOutcome → job 结果序列化(postId 串形态;fallback 标记透传) */
function toJobResult(outcome: ComposeOutcome, fallback: boolean): TopicComposeResult {
  return {
    postId: outcome.postId.toString(),
    postTitle: outcome.postTitle,
    recomposed: outcome.recomposed,
    coverPath: outcome.coverPath,
    fallback,
  };
}

/** 封面转存 + 落稿锚定(共享核)并序列化 job 结果 */
async function persist(
  topic: Awaited<ReturnType<typeof getTopic>>,
  blocks: ComposeMaterialBlock[],
  result: ComposeResult,
  fallback: boolean,
): Promise<TopicComposeResult> {
  const primaryCoverUrl = blocks.find((b) => b.kind === "telegram")?.coverUrl ?? null;
  const coverPath = primaryCoverUrl ? await transferCoverOrNull(primaryCoverUrl) : null;
  const outcome = await finalizeCompose(topic, result, blocks, coverPath);
  if (fallback) {
    logger.info({ event: "topic.compose_fallback_done", postId: outcome.postId.toString() });
  }
  return toJobResult(outcome, fallback);
}
