/**
 * 封面候选编排(D3 的 HTTP 触发面与站内 agent 工具共用一份):
 * 触发 → 生图入队(hold,不进媒体库)→ 轮询等候选 → 交预览;确认则入库并设封面。
 *
 * 为什么抽出来(同源纪律):封面生成原先 100% 由 agent 工具发起,站内没有第二条
 * 触发路径——agent 工具在 B4 整体删除后,编辑器就彻底失去后端。本模块是执行核心
 * 的调用面编排,不含 agent 依赖(不引 langgraph/interrupt),两处消费方各自决定
 * 错误文案与交互形态。
 *
 * hold 语义不变:候选落临时盘不进媒体库,adopt 时才 uploadMedia;预览走
 * `GET /api/posts/cover-candidates/[id]/raw`(token 走 x-cover-token 头)。
 */
import { randomUUID } from "node:crypto";

import { AiAdminError } from "@/lib/ai/errors";
import {
  adoptCoverCandidate,
  deleteCoverTemp,
  enqueueCoverGen,
  listHeldCandidatesForPost,
  loadCoverPostContext,
  probeCoverGen,
  type CoverGenProbeHit,
} from "@/lib/ai/cover-generate";
import { updatePostCover } from "@/lib/content/posts-admin";
import { logger } from "@/lib/logger";

import { pollUntil } from "./poll";

/** 预览取图路径(与站内 agent 候选卡同一入口) */
export function coverCandidateUrl(id: string): string {
  return `/api/posts/cover-candidates/${id}/raw`;
}

export type CoverCandidateFailure = "not_found" | "disabled" | "timeout" | "failed";

export type CoverCandidateOutcome =
  | { ok: true; token: string; candidates: { id: string; url: string }[] }
  | { ok: false; reason: CoverCandidateFailure; message: string };

/**
 * 触发封面候选生成并等到出图(或失败)。
 *
 * 已有存活 hold 候选时**直接复用**(resume 重放防重的同一口径):LangGraph
 * interrupt 恢复时工具体会整体重跑,无守卫会把「入队生图 + 轮询等图」整条再走
 * 一遍(重复计费 + 白等)。
 */
export async function requestCoverCandidates(input: {
  postId: string;
  prompt?: string;
}): Promise<CoverCandidateOutcome> {
  const ctx = await loadCoverPostContext(input.postId);
  if (!ctx) return { ok: false, reason: "not_found", message: "文章不存在或已删除" };

  const held = await listHeldCandidatesForPost(input.postId);
  if (held.length > 0) {
    logger.info({
      event: "cover.candidates_reused",
      postId: input.postId,
      count: held.length,
    });
    return {
      ok: true,
      token: held[0].token,
      candidates: held.map((r) => ({ id: r.id, url: coverCandidateUrl(r.id) })),
    };
  }

  const token = randomUUID();
  let jobId: string;
  try {
    ({ jobId } = await enqueueCoverGen({
      token,
      postId: input.postId,
      title: ctx.title,
      excerpt: ctx.excerpt,
      tags: ctx.tags,
      contentMd: ctx.contentMd,
      prompt: input.prompt ?? "",
      hold: true, // 不进媒体库;adopt 确认后才 uploadMedia
    }));
  } catch (e) {
    if (e instanceof AiAdminError) {
      return { ok: false, reason: "disabled", message: e.message };
    }
    throw e;
  }
  logger.info({ event: "cover.candidates_enqueued", token, postId: input.postId, jobId });

  // 单拍探测:候选出图即收工;job 失败立刻断路(不傻等满预算)
  const outcome = await pollUntil<CoverGenProbeHit>(() => probeCoverGen(token, jobId));
  if (outcome === null) {
    return {
      ok: false,
      reason: "timeout",
      message: "封面生成超时(云厂商生图通常 10-30 秒),可重试",
    };
  }
  if ("failure" in outcome) {
    await deleteCoverTemp(token); // 清可能的半成品临时件
    return {
      ok: false,
      reason: "failed",
      message: `生图失败:${outcome.failure}(可重试,或在 AI 配置调大生图模型超时)`,
    };
  }
  return {
    ok: true,
    token,
    candidates: outcome.rows.map((r) => ({ id: r.id, url: coverCandidateUrl(r.id) })),
  };
}

/**
 * 采纳一张候选:临时件 → 媒体库 → 设为文章封面。设封面失败不回滚入库,降级
 * 回报(管理员可在封面设置处从媒体库手动选用,同既有口径)。
 */
export async function adoptCoverForPost(input: {
  candidateId: string;
  postId: string;
}): Promise<{ path: string; coverSet: boolean; coverError?: string }> {
  const path = await adoptCoverCandidate(input.candidateId);
  try {
    await updatePostCover(BigInt(input.postId), path);
    return { path, coverSet: true };
  } catch (e) {
    return {
      path,
      coverSet: false,
      coverError: e instanceof Error ? e.message : "未知错误",
    };
  }
}

/** 放弃整批候选:清临时件,不进媒体库 */
export async function discardCoverCandidates(token: string): Promise<void> {
  await deleteCoverTemp(token);
  logger.info({ event: "cover.candidates_discarded", token });
}
