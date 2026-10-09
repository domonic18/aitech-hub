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
      "向用户提出澄清问题(以交互卡片展示,用户的回答会作为本工具结果返回)。question 为问题文本(≤500 字);options 为候选选项(2-4 个,每个 ≤100 字,用户可直接点选,可省略)。仅当关键信息缺失且无法靠 search_site 检索补足时使用;一次只问一个问题,拿到回答后再继续。",
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
