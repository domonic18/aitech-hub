/**
 * 编辑页封面 agent 工具面(M31 验收反馈,admin 独占):generate_post_cover——
 * 读库内文章上下文(标题/摘要/全部标签/正文取样)→ cover-gen 队列 hold 生成
 * (临时盘不进媒体库)→ interrupt 挂起交 CoverCandidatesCard 预览,管理员
 * 「入库」/「全部放弃」resume 回灌;adopt 分支才 uploadMedia。与 topic 域的
 * generate_cover_candidates 同管线不同面(那边返回路径自选,这边 HITL 确认
 * 入库),工具名错开防注册冲突。方向对齐靠 ask_user(系统提示 + 工具描述
 * 双重引导,管理员确认方向后再调本工具)。
 */
import { randomUUID } from "node:crypto";

import { tool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import { z } from "zod";

import {
  adoptCoverCandidate,
  deleteCoverTemp,
  enqueueCoverGen,
  listHeldCandidatesForPost,
  loadCoverPostContext,
  probeCoverGen,
  type CoverGenProbeHit,
} from "../ai/cover-generate";
import { AiAdminError } from "../ai/errors";
import { logger } from "../logger";
import { updatePostCover } from "../content/posts-admin";

import { adminThreadDeny, assertAdminThread } from "./admin-thread";
import {
  AGENT_COVER_CANDIDATES_TOOL,
  parseAgentCoverResume,
  type AgentCoverCandidate,
} from "./cover-tool";
import { pollUntil } from "./poll";

export const generatePostCoverTool = tool(
  async ({ id, prompt }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id))) {
      return adminThreadDeny(config?.configurable?.thread_id, "edit");
    }
    const ctx = await loadCoverPostContext(id);
    if (!ctx) return JSON.stringify({ ok: false, error: "文章不存在或已删除" });

    // resume 重放防重(2026-10-16 反馈问题一):LangGraph interrupt 恢复时工具体
    // 从顶部整体重跑,无守卫会把「入队生图 + 轮询等图」整条流水线再执行一遍
    // (重复计费 2 张 + 再干等 10-30s,用户侧表现为点「入库」后久转)。该文已有
    // 存活 hold 候选 = 上轮已生成过,直接复用进 interrupt,不再入队/轮询。
    let candidates: AgentCoverCandidate[];
    let token: string;
    const held = await listHeldCandidatesForPost(id);
    if (held.length > 0) {
      token = held[0].token;
      candidates = held.map((r) => ({
        id: r.id,
        url: `/api/posts/cover-candidates/${r.id}/raw`,
      }));
      logger.info({ event: "agent.post_cover_replay_skip", postId: id, count: held.length });
    } else {
      token = randomUUID();
      let jobId: string;
      try {
        ({ jobId } = await enqueueCoverGen({
          token,
          postId: id,
          title: ctx.title,
          excerpt: ctx.excerpt,
          tags: ctx.tags,
          contentMd: ctx.contentMd,
          prompt: prompt ?? "",
          hold: true, // 不进媒体库;adopt 确认后才 uploadMedia
        }));
      } catch (e) {
        if (e instanceof AiAdminError) return JSON.stringify({ ok: false, error: e.message });
        throw e;
      }
      logger.info({ event: "agent.post_cover_started", token, postId: id });

      // 单拍探测:候选出图即收工;job 失败立刻断路(不傻等满预算,问题二)
      const outcome = await pollUntil<CoverGenProbeHit>(() => probeCoverGen(token, jobId));
      if (outcome === null) {
        return JSON.stringify({
          ok: false,
          timeout: true,
          error: "封面生成超时(云厂商生图通常 10-30 秒),可重试",
        });
      }
      if ("failure" in outcome) {
        await deleteCoverTemp(token); // 清可能的半成品临时件
        return JSON.stringify({
          ok: false,
          error: `生图失败:${outcome.failure}(可重试,或在 AI 配置调大生图模型超时)`,
        });
      }
      // token 不进 URL(会落访问/代理日志,批④加固):载荷单独携带,卡片经
      // x-cover-token 头取图;url 只留候选 id。
      candidates = outcome.rows.map((r) => ({
        id: r.id,
        url: `/api/posts/cover-candidates/${r.id}/raw`,
      }));
    }
    // HITL 挂起:预览卡确认;resume = {decision:"adopt",candidateId} | {decision:"discard"}
    // postId 供前端 adopt 完成后定向通知编辑器刷新(同反馈问题一)。
    const answer = interrupt({
      kind: AGENT_COVER_CANDIDATES_TOOL,
      prompt: prompt ?? "(空——由 agent 依文章内容自动撰写)",
      token,
      candidates,
      postId: id,
    });
    const resume = parseAgentCoverResume(answer);

    if (resume?.decision === "adopt") {
      try {
        const path = await adoptCoverCandidate(resume.candidateId);
        // 入库即设为文章封面(2026-10-15 验收反馈问题二:两步操作并一步);
        // 设封面失败不回滚入库,降级汇报由管理员在封面设置处手动选用
        try {
          await updatePostCover(BigInt(id), path);
          return JSON.stringify({
            ok: true,
            decision: "adopt",
            path,
            summary: `已入媒体库并设为文章封面:${path}`,
          });
        } catch (e) {
          return JSON.stringify({
            ok: true,
            decision: "adopt",
            path,
            summary: `已入媒体库:${path};设为文章封面失败(${
              e instanceof Error ? e.message : "未知错误"
            }),可在封面设置处从媒体库手动选用`,
          });
        }
      } catch (e) {
        return JSON.stringify({
          ok: false,
          decision: "adopt",
          error: e instanceof Error ? e.message : "入库失败",
        });
      }
    }
    // 放弃(或 resume 形状异常同路):清临时件,不入库
    await deleteCoverTemp(token);
    return JSON.stringify({ ok: true, decision: "discard", summary: "已放弃,候选未入库" });
  },
  {
    name: "generate_post_cover",
    description:
      "为当前编辑的文章生成封面候选(2 张,约 10-30 秒,本工具会等待到出图),随后挂起" +
      "等待管理员在预览卡上确认:点「入库」的候选存入媒体库并直接设为该文章封面," +
      "「全部放弃」则不落库。调用前必须完成两段 ask_user 对齐(缺一段不得调用):" +
      "第一段先读文章内容推理 2-4 个差异化封面方向,每个选项=风格+主体+配色+拟融入画面的" +
      "主题文字,必须结合本文主题具体化,禁止每次都给雷同的泛化风格词;" +
      "第二段把选定方向写成完整生图 prompt,经 ask_user 的 detail 字段完整展示," +
      "options 给「确认生成」类选项让管理员逐字确认;prompt 中应要求画面融入文章主题相关的" +
      "简短中文文字(2~8 字主题词)。本工具 prompt 只传管理员确认过的原稿,不要自行改写。" +
      "id 取页面上下文 edit.postId。",
    schema: z.object({
      id: z.string().regex(/^\d+$/).describe("文章 id(纯数字,即页面上下文的 edit.postId)"),
      prompt: z
        .string()
        .trim()
        .max(2000)
        .optional()
        .describe("生图提示词(与管理员对齐方向后撰写;省略则按文章内容自动撰写)"),
    }),
  },
);

export const COVER_TOOLS = [generatePostCoverTool];
