/**
 * 编辑域工具(M27 批⑧-b/c,admin 独占;技术债批⑤ 自 tools 拆出):
 * read_draft 读现稿 + propose_edits 改稿提案(HITL 中断评审,提案不落笔)。
 * 挂载仅 admin 图(agent.ts),体内再验会话行归属 admin(fail-closed)。
 */
import { tool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import { z } from "zod";

import { prisma } from "../db";
import { logger } from "../logger";

import { adminThreadDeny, assertAdminThread } from "./admin-thread";
import { AGENT_PROPOSE_EDITS_TOOL, type ProposeEditsResume } from "./edit-proposal";

/** 单篇正文进上下文的截断长度(字符;约 4-6k tokens,12 步护栏内可承受多轮;
 * tools 的 read_post/read_repo 同用,自此件出口) */
export const TOOL_BODY_MAX = 6000;

/**
 * 读编辑中的文章草稿(M27 批⑧-b,admin 独占):read_post 只认已发布,而
 * 页面上下文 edit.postId 指向的文章多为草稿——本工具读任意状态(已删除除外),
 * 模型先看现稿再谈修改,不再「猜文章」。纵深防御:工具面仅挂 admin 图
 * (agent.ts),体内再验会话行归属 admin(fail-closed,topic-tools 同款)。
 */
export const readDraftTool = tool(
  async ({ id }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id))) {
      return adminThreadDeny(config?.configurable?.thread_id, "edit");
    }
    const post = await prisma.post.findFirst({
      where: { id: BigInt(id), status: { not: "deleted" } },
      select: { title: true, status: true, contentMd: true },
    });
    if (!post) return JSON.stringify({ ok: false, error: "文章不存在" });
    const full = post.contentMd ?? "";
    return JSON.stringify({
      id,
      title: post.title,
      status: post.status,
      content: full.slice(0, TOOL_BODY_MAX),
      content_length: full.length,
      truncated: full.length > TOOL_BODY_MAX,
    });
  },
  {
    name: "read_draft",
    description:
      "读管理员正在编辑的文章(任意状态:草稿/已发布均可,已删除除外)。返回标题、状态" +
      "与 Markdown 正文(超长截断,truncated 为 true 时 content_length 是全长)。页面上下文" +
      "含 edit.postId、或用户说「这篇文章/当前文章」时,先用它读全文再讨论或修改。",
    schema: z.object({
      id: z.string().regex(/^\d+$/).describe("文章 id(纯数字,即页面上下文的 edit.postId)"),
    }),
  },
);

/**
 * propose_edits 改稿提案(M27 批⑧-c,admin 独占,提案不落笔):工具体内裸调
 * interrupt() 挂起(ask_user 同款机制),载荷 = S/R 块(edits 档,Claude Code
 * Edit 语义)或整档重写(rewrite 档),零写库——写入永远 = 管理员在评审面
 * 接受 → 编辑器回写 → 既有自动保存落库。resume 值经 stream 路由 zod 把关,
 * 此处防御性规整并归一为模型可读结果;unavailable(评审面不在场)引导换入口。
 */
export const proposeEditsTool = tool(
  async ({ edits, content_md, note }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id))) {
      return adminThreadDeny(config?.configurable?.thread_id, "edit");
    }
    const answer = interrupt({
      kind: AGENT_PROPOSE_EDITS_TOOL,
      mode: content_md === undefined ? "edits" : "rewrite",
      note,
      ...(content_md === undefined ? { edits } : { contentMd: content_md }),
    });
    let decision = "";
    let applied: number | undefined;
    let comment: string | undefined;
    if (typeof answer === "object" && answer !== null) {
      const a = answer as Partial<ProposeEditsResume>;
      if (typeof a.decision === "string") decision = a.decision;
      if (typeof a.applied === "number") applied = a.applied;
      if (typeof a.comment === "string") comment = a.comment;
    }
    if (decision === "applied" || decision === "partial") {
      logger.info({ event: "agent.edit_proposal_applied", decision, applied });
      return JSON.stringify({
        ok: true,
        decision,
        applied: applied ?? 0,
        summary:
          decision === "applied"
            ? "管理员已接受全部提案并写入编辑器(改动尚未保存,后续自动保存落库)"
            : `管理员部分接受提案(${applied ?? 0} 块写入)${comment ? `;评语:${comment}` : ""}`,
      });
    }
    if (decision === "rejected") {
      logger.info({ event: "agent.edit_proposal_rejected" });
      return JSON.stringify({
        ok: false,
        decision,
        summary: `提案被拒绝${comment ? `,评语:${comment}` : ";未说明原因"}`,
      });
    }
    // unavailable(当前页面无评审面)与形状异常兜底同路:引导换入口
    return JSON.stringify({
      ok: false,
      decision: "unavailable",
      summary: "当前页面没有可用的评审界面,提案未送达。请管理员到文章编辑页使用编辑助手再试",
    });
  },
  {
    name: AGENT_PROPOSE_EDITS_TOOL,
    description:
      "向管理员提交文章修改提案(不直接写库):管理员在评审界面逐块确认后才会写入编辑器。" +
      "默认用局部修改档(edits);「重写全文/按某风格整体改写」类大改才用整档重写档" +
      "(content_md)。oldString 必须从 read_draft 返回的现稿逐字符复制且保证全文唯一命中。" +
      "提交后本工具会等待管理员评审:applied=全部接受,partial=部分接受,rejected=拒绝" +
      "(按评语调整后可再次提案),unavailable=此处无评审界面(请管理员到文章编辑页)。",
    schema: z
      .object({
        note: z.string().trim().min(1).max(1000).describe("提案总体说明:改什么、为什么这样改"),
        edits: z
          .array(
            z.object({
              oldString: z.string().min(1).max(8000).describe("原文片段(逐字符精确,全文唯一)"),
              newString: z.string().max(8000).describe("替换后的新文本"),
              note: z.string().max(200).optional().describe("本块改动意图(可选)"),
            }),
          )
          .min(1)
          .max(20)
          .optional()
          .describe("局部修改块列表(与 content_md 二选一)"),
        content_md: z
          .string()
          .min(1)
          .max(50_000)
          .optional()
          .describe("整档重写的新全文 markdown(与 edits 二选一)"),
      })
      .refine((v) => (v.edits !== undefined) !== (v.content_md !== undefined), {
        message: "edits 与 content_md 必须二选一",
      }),
  },
);

/** 编辑域工具(admin 独占挂载:读现稿 + 改稿提案) */
export const EDIT_TOOLS = [readDraftTool, proposeEditsTool];
