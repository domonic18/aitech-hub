/**
 * Agent 只读工具面(K2.5,arch/04 §3):站内三域检索 + 文章/项目正文补读。
 * 检索复用 K1 unified-search#searchAll(给人搜索 = 给智能体检索,同源不漂移);
 * K 系列只读红线(§3 已定):无任何 mutation 工具。返回串直接进模型上下文,
 * 一律 JSON.stringify 且正文截断(50k tokens 会话护栏的口径基础)。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { PUBLISHED } from "../content/posts";
import { prisma } from "../db";
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

export const AGENT_TOOLS = [searchSiteTool, readPostTool, readRepoTool];
