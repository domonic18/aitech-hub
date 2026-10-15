/**
 * Agent 工具面(K2.5,arch/04 §3;K2.6 收紧):站内三域检索 + 文章/项目
 * 正文补读 + 当前时间锚定 + ask_user 结构化提问(2026-10-09 验收反馈,HITL
 * 中断卡片);M22 批⑤起唯一可写口 submit_feedback(用户反馈落库)。检索复用
 * K1 unified-search#searchAll(给人搜索 = 给智能体检索,同源不漂移);除反馈
 * 外维持只读红线:无站外网络/文件/代码执行能力(系统提示明示边界)。返回串
 * 直接进模型上下文,一律 JSON.stringify 且正文截断(50k tokens 会话护栏的
 * 口径基础)。
 */
import { tool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import { z } from "zod";

import { PUBLISHED } from "../content/posts";
import { submitFeedbackSchema } from "../feedback/feedback-schema";
import { prisma } from "../db";
import { adminThreadDeny, assertAdminThread } from "./admin-thread";
import { AGENT_PROPOSE_EDITS_TOOL, type ProposeEditsResume } from "./edit-proposal";
import { AGENT_ASK_USER_TOOL, type AgentAskUserResume } from "./hitl";
import { logger } from "../logger";
import { searchAll } from "../search/unified-search";

/** 单篇正文进上下文的截断长度(字符;约 4-6k tokens,12 步护栏内可承受多轮) */
export const TOOL_BODY_MAX = 6000;

/** 三域检索结果 → 模型友好摘要(items 每域限量已在 searchAll 内收口) */
export function summarizeSearchGroups(result: Awaited<ReturnType<typeof searchAll>>): string {
  const groups = Object.entries(result.groups).map(([domain, g]) => ({
    domain,
    total: g.total,
    items: g.items.map((it) => ({
      id: it.id,
      title: it.title,
      href: it.href,
      snippet: it.snippet,
    })),
  }));
  return JSON.stringify({ total: result.total, groups });
}

export const searchSiteTool = tool(async ({ q }) => summarizeSearchGroups(await searchAll(q)), {
  name: "search_site",
  description:
    "站内三域检索(资讯/教程/项目)。输入自然语言或关键词,返回命中计数与每组条目(id/title/href/snippet)。需要展开某篇正文时,用其 id 调 read_post 或 read_repo。",
  schema: z.object({
    q: z.string().min(1).max(100).describe("检索词,中文自然语言或关键词"),
  }),
});

export const readPostTool = tool(
  async ({ id }) => {
    const post = await prisma.post.findFirst({
      where: { id: BigInt(id), ...PUBLISHED },
      select: { title: true, contentMd: true },
    });
    if (!post) return JSON.stringify({ error: "文章不存在或未发布" });
    const body = (post.contentMd ?? "").slice(0, TOOL_BODY_MAX);
    return JSON.stringify({ id, title: post.title, content: body });
  },
  {
    name: "read_post",
    description:
      "读站内文章正文(教程)。输入 search_site 返回的 post id;返回标题与 Markdown 正文(超长截断)。",
    schema: z.object({
      id: z.string().regex(/^\d+$/).describe("文章 id(纯数字字符串)"),
    }),
  },
);

export const readRepoTool = tool(
  async ({ id }) => {
    const repo = await prisma.githubRepo.findFirst({
      where: { id: Number(id), display: true },
      select: { fullName: true, description: true, readmeMd: true },
    });
    if (!repo) return JSON.stringify({ error: "项目不存在或未展示" });
    const body = (repo.readmeMd ?? "").slice(0, TOOL_BODY_MAX);
    return JSON.stringify({
      id,
      fullName: repo.fullName,
      description: repo.description,
      readme: body,
    });
  },
  {
    name: "read_repo",
    description:
      "读站内收录的开源项目 README。输入 search_site 返回的 repo id;返回项目名、简介与 README(超长截断)。",
    schema: z.object({
      id: z.string().regex(/^\d+$/).describe("项目 id(纯数字字符串)"),
    }),
  },
);

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

/** 当前时间(北京时区;agent 无时钟感知,「今天/最近」类问题靠它锚定) */
export const getTimeTool = tool(
  async () => {
    const now = new Date();
    const beijing = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
    return JSON.stringify({ iso: now.toISOString(), beijing, timezone: "Asia/Shanghai" });
  },
  {
    name: "get_time",
    description:
      "获取当前时间(北京时区)。涉及「今天/最近/最新」等相对时间的问题,先调它锚定当前日期。",
    schema: z.object({}).describe("无参数"),
  },
);

/**
 * ask_user 结构化提问(2026-10-09 验收反馈):工具体内裸调 langgraph
 * interrupt() 暂停图(checkpointer 持久),前端渲染提问卡片,回答经
 * Command({resume}) 灌回——interrupt() 返回 resume 值,工具以正常 ToolMessage
 * 回给模型。恢复时工具体从头重放(中断点前无副作用,安全)。resume 值形状
 * 由 stream 路由 zod 把关,此处防御性规整(旧客户端/绕道路径兜底)。
 */
export const askUserTool = tool(
  async ({ question, options }) => {
    const answer = interrupt({
      kind: AGENT_ASK_USER_TOOL,
      question,
      ...(options && options.length > 0 ? { options } : {}),
    });
    let message = "";
    let option: string | undefined;
    if (typeof answer === "object" && answer !== null) {
      const a = answer as Partial<AgentAskUserResume>;
      if (typeof a.message === "string") message = a.message;
      if (typeof a.option === "string") option = a.option;
    } else if (typeof answer === "string") {
      message = answer; // 老式纯文本 resume 兜底
    }
    if (message.trim() === "") {
      return JSON.stringify({ ok: false, answer: "(用户未作答)" });
    }
    return JSON.stringify({
      ok: true,
      answer: message,
      ...(option ? { selected_option: option } : {}),
    });
  },
  {
    name: AGENT_ASK_USER_TOOL,
    description:
      "向用户提问并等待回答:需要用户确认、拍板或补充关键信息时调用,用户会在前端看到交互卡片并作答," +
      "答案作为本工具结果返回。不要用普通对话文本提问——纯文本问法前端弹不出卡片,用户无法结构化作答。" +
      "规则:一次只问一个问题,不要并行发起多个;question 为问题文本(≤500 字);options 为候选选项" +
      "(2-4 个纯字符串,不要用对象包裹,每个 ≤100 字,推荐项放第一个,可省略);用户回答后先简要确认理解再继续;" +
      "仅当关键信息缺失且无法靠 search_site 检索补足时使用。",
    schema: z.object({
      question: z.string().min(1).max(500).describe("要问用户的问题"),
      options: z
        .array(z.string().min(1).max(100))
        .min(2)
        .max(4)
        .optional()
        .describe("候选选项,用户可直接点选;无可选项则省略"),
    }),
  },
);

/**
 * 用户反馈提交(M22 批⑤,需求8):工具面唯一可写口——把对话中识别出的反馈
 * 落 Feedback 表(admin 后台流转,无邮件通知)。sessionId 取 run 注入的
 * LangChain config(configurable.thread_id,LangGraph 工具调用自动透传,
 * 模型参数里没有这个字段、不可伪造),归属经会话表溯源,不直落 userId/
 * visitorId。入参契约共用 submitFeedbackSchema(与 admin 表单同一真相源)。
 */
export const submitFeedbackTool = tool(
  async ({ category, content, contact }, config) => {
    const threadId = config?.configurable?.thread_id;
    const sessionId = typeof threadId === "string" && threadId !== "" ? threadId : undefined;
    try {
      const row = await prisma.feedback.create({
        data: {
          category,
          content,
          contact: contact === "" ? null : (contact ?? null),
          sessionId,
          status: "open",
        },
        select: { id: true },
      });
      logger.info({
        event: "feedback.submitted",
        feedbackId: row.id.toString(),
        category,
        fromAgent: true,
      });
      return JSON.stringify({ ok: true, message: "反馈已提交,感谢你的反馈!" });
    } catch (e) {
      logger.warn({
        event: "feedback.submit_failed",
        error: e instanceof Error ? e.message : String(e),
      });
      return JSON.stringify({ ok: false, message: "反馈提交失败,请稍后再试。" });
    }
  },
  {
    name: "submit_feedback",
    description:
      "把用户的反馈提交给站长(记录到反馈系统,人工跟进)。category 取值:requirement(需求/合作)、issue(问题/故障)、suggestion(建议)、other(其他);content 为反馈正文(5-2000 字,先与用户确认内容);contact 为联系方式(邮箱/微信号等,≤200 字,仅在用户明确提供或同意时填写,可省略)。仅在用户表达联系/反馈意愿并确认内容后才调用。",
    schema: submitFeedbackSchema,
  },
);

export const AGENT_TOOLS = [
  searchSiteTool,
  readPostTool,
  readRepoTool,
  getTimeTool,
  askUserTool,
  submitFeedbackTool,
];
