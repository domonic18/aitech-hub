/**
 * 编辑页封面 agent 工具面(M31 验收反馈,admin 独占):generate_post_cover——
 * 读库内文章上下文(标题/摘要/全部标签/正文取样)→ cover-gen 队列 hold 生成
 * (临时盘不进媒体库)→ 候选就绪后按档收尾,两档共用生成管线与 adopt 落库:
 * - 手动档(默认,编辑页单独生成):interrupt 挂起交 CoverCandidatesCard 预览,
 *   管理员「入库」/「全部放弃」resume 回灌;adopt 分支才 uploadMedia。
 * - auto 档(auto_adopt:true,2026-10-20 专题合成免确认):候选就绪直接采纳
 *   第一张并设为文章封面,不产生 interrupt——一键合成全程零打断。
 * 与 topic 域的 generate_cover_candidates 同管线不同面(那边返回路径自选,这边
 * 确认/自动入库),工具名错开防注册冲突。方向对齐:手动档靠两段 ask_user(系统
 * 提示 + 工具描述双重引导);auto 档由 agent 自拟高质量 prompt,免确认不降质。
 */
import { tool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import { z } from "zod";

import {
  adoptCoverForPost,
  discardCoverCandidates,
  requestCoverCandidates,
} from "../ai/cover-candidates";
import { logger } from "../logger";

import { adminThreadDeny, assertAdminThread } from "./admin-thread";
import {
  AGENT_COVER_CANDIDATES_TOOL,
  GENERATE_POST_COVER_TOOL,
  parseAgentCoverResume,
  type AgentCoverCandidate,
} from "./cover-tool";

export const generatePostCoverTool = tool(
  async ({ id, prompt, auto_adopt }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id))) {
      return adminThreadDeny(config?.configurable?.thread_id, "edit");
    }

    // 生图编排与 HTTP 触发面共用一份(D3):入队(hold,不进媒体库)→ 轮询等候选;
    // 该文已有存活 hold 候选时直接复用(resume 重放防重:LangGraph interrupt 恢复
    // 时工具体整体重跑,无守卫会把整条流水线再走一遍——重复计费 + 白等)。
    const outcome = await requestCoverCandidates({ postId: id, prompt });
    if (!outcome.ok) {
      if (outcome.reason === "not_found") {
        return JSON.stringify({ ok: false, error: "文章不存在或已删除" });
      }
      if (outcome.reason === "timeout") {
        return JSON.stringify({ ok: false, timeout: true, error: outcome.message });
      }
      return JSON.stringify({ ok: false, error: outcome.message });
    }
    const token = outcome.token;
    const candidates: AgentCoverCandidate[] = outcome.candidates.map((c) => ({
      id: c.id,
      url: c.url,
    }));
    // auto 档(2026-10-20 专题合成免确认):候选就绪直接采纳第一张并设为文章
    // 封面,不产生 interrupt——一键合成全程零打断;adopt 失败照实报错(held
    // 候选仍在,重试走复用路),设封面失败降级 ok:true。
    if (auto_adopt) {
      const first = candidates[0];
      let adopted: { path: string; coverSet: boolean; coverError?: string };
      try {
        adopted = await adoptCoverForPost({ candidateId: first.id, postId: id });
      } catch (e) {
        return JSON.stringify({
          ok: false,
          decision: "adopt",
          auto: true,
          error: e instanceof Error ? e.message : "入库失败",
        });
      }
      logger.info({ event: "agent.post_cover_auto_adopt", postId: id, ok: true });
      return JSON.stringify({
        ok: true,
        decision: "adopt",
        auto: true,
        path: adopted.path,
        summary: adopted.coverSet
          ? `已自动生成并采用文章封面:${adopted.path}`
          : `封面已入媒体库:${adopted.path};设为文章封面失败(${adopted.coverError}),可在封面设置处手动选用`,
      });
    }

    // 手动档 HITL 挂起:预览卡确认;resume = {decision:"adopt",candidateId} | {decision:"discard"}
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
      let adopted: { path: string; coverSet: boolean; coverError?: string };
      try {
        adopted = await adoptCoverForPost({ candidateId: resume.candidateId, postId: id });
      } catch (e) {
        return JSON.stringify({
          ok: false,
          decision: "adopt",
          error: e instanceof Error ? e.message : "入库失败",
        });
      }
      return JSON.stringify({
        ok: true,
        decision: "adopt",
        path: adopted.path,
        summary: adopted.coverSet
          ? `已入媒体库并设为文章封面:${adopted.path}`
          : `已入媒体库:${adopted.path};设为文章封面失败(${adopted.coverError}),可在封面设置处从媒体库手动选用`,
      });
    }
    // 放弃(或 resume 形状异常同路):清临时件,不入库
    await discardCoverCandidates(token);
    return JSON.stringify({ ok: true, decision: "discard", summary: "已放弃,候选未入库" });
  },
  {
    name: GENERATE_POST_COVER_TOOL,
    description:
      "为当前编辑的文章生成封面候选(2 张,约 10-30 秒,本工具会等待到出图),收尾分两档:" +
      "①手动档(默认,不传 auto_adopt):挂起等待管理员在预览卡确认,点「入库」存媒体库并设为" +
      "文章封面,「全部放弃」不落库。调用前必须完成两段 ask_user 对齐(缺一段不得调用):" +
      "第一段先读文章内容推理 2-4 个差异化封面方向,每个选项=风格+主体+配色+拟融入画面的" +
      "主题文字,必须结合本文主题具体化,禁止每次都给雷同的泛化风格词;" +
      "第二段把选定方向写成完整生图 prompt,经 ask_user 的 detail 字段完整展示," +
      "options 给「确认生成」类选项让管理员逐字确认;prompt 只传管理员确认过的原稿,不要自行改写。" +
      "②自动档(auto_adopt:true):仅供专题初稿生成/重新生成流程使用,候选就绪自动采纳第一张并设为" +
      "文章封面,全程不打断管理员——此时自行撰写高质量 prompt(要求画面融入文章主题相关的" +
      "2~8 字中文主题词),质量不得因免确认降低;管理员单独要求生成封面时严禁传 true。" +
      "id 取页面上下文 edit.postId。",
    schema: z.object({
      id: z.string().regex(/^\d+$/).describe("文章 id(纯数字,即页面上下文的 edit.postId)"),
      prompt: z
        .string()
        .trim()
        .max(2000)
        .optional()
        .describe(
          "生图提示词(手动档须传管理员确认过的原稿;自动档自行撰写;省略则按文章内容自动撰写)",
        ),
      auto_adopt: z
        .boolean()
        .optional()
        .describe(
          "自动档开关:true=候选就绪直接采纳第一张并设为封面,不发起确认(仅专题初稿生成/重新生成" +
            "流程用;管理员在编辑页单独要求生成封面时严禁传 true)",
        ),
    }),
  },
);

export const COVER_TOOLS = [generatePostCoverTool];
