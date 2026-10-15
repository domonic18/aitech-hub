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
  listCoverCandidates,
  loadCoverPostContext,
} from "../ai/cover-generate";
import { AiAdminError } from "../ai/errors";
import { logger } from "../logger";

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

    const token = randomUUID();
    try {
      await enqueueCoverGen({
        token,
        postId: id,
        title: ctx.title,
        excerpt: ctx.excerpt,
        tags: ctx.tags,
        contentMd: ctx.contentMd,
        prompt: prompt ?? "",
        hold: true, // 不进媒体库;adopt 确认后才 uploadMedia
      });
    } catch (e) {
      if (e instanceof AiAdminError) return JSON.stringify({ ok: false, error: e.message });
      throw e;
    }
    logger.info({ event: "agent.post_cover_started", token, postId: id });

    const rows = await pollUntil(async () => {
      const hit = await listCoverCandidates(token);
      return hit.length > 0 ? hit : null;
    });
    if (rows === null) {
      return JSON.stringify({
        ok: false,
        timeout: true,
        error: "封面生成超时(云厂商生图通常 10-30 秒),可重试",
      });
    }

    // token 不进 URL(会落访问/代理日志,批④加固):载荷单独携带,卡片经
    // x-cover-token 头取图;url 只留候选 id。
    const candidates: AgentCoverCandidate[] = rows.map((r) => ({
      id: r.id,
      url: `/api/posts/cover-candidates/${r.id}/raw`,
    }));
    // HITL 挂起:预览卡确认;resume = {decision:"adopt",candidateId} | {decision:"discard"}
    const answer = interrupt({
      kind: AGENT_COVER_CANDIDATES_TOOL,
      prompt: prompt ?? "(空——由 agent 依文章内容自动撰写)",
      token,
      candidates,
    });
    const resume = parseAgentCoverResume(answer);

    if (resume?.decision === "adopt") {
      try {
        const path = await adoptCoverCandidate(resume.candidateId);
        return JSON.stringify({
          ok: true,
          decision: "adopt",
          path,
          summary: `已入媒体库:${path}(可在封面设置处从媒体库选用为文章封面)`,
        });
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
      "等待管理员在预览卡上确认:点「入库」的候选才存入媒体库,「全部放弃」则不落库。" +
      "调用前必须先用 ask_user 与管理员对齐提示词方向(风格/主体/配色,给出 2-4 个" +
      "方向选项);对齐后把方向写成生图 prompt 传入(prompt 可空,空则按文章内容" +
      "自动撰写)。管理员确认入库后,工具结果含站内路径,提示其到封面设置处从" +
      "媒体库选用。id 取页面上下文 edit.postId。",
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
