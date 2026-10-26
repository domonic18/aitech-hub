/**
 * 小红书分发 agent 工具(M49 批X2' 撰写改走侧边栏 agent 会话):模型改写产物经
 * save_xhs_draft 结构化落库(硬闸 zod + 码点双闸,超限中文反馈由既有
 * tool_args_feedback 管线自动回话自纠);3:4 封面卡在工具内渲染(card-renderer)。
 * 仅 admin 图装配(agentToolsFor);发布动作永远人工(无官方发布 API,plan M49)。
 */
import { z } from "zod";

import { renderCardPng } from "../card/render";
import { prisma } from "../db";
import { mediaStorage } from "../media/storage";
import { ensureChannelRowUnique } from "../distribute/channel-row";
import {
  CHANNEL_XHS,
  PUBLISH_STATUS_READY,
  XHS_CONTENT_MAX,
  XHS_TAGS_MAX,
  XHS_TITLE_MAX,
} from "../distribute/channels";
import { tool } from "@langchain/core/tools";

function escHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function coverHtml(title: string): string {
  const t = escHtml(title);
  return (
    `<div style="width:1080px;height:1440px;box-sizing:border-box;display:flex;flex-direction:column;` +
    `justify-content:space-between;padding:96px;background:linear-gradient(160deg,#1e1b4b 0%,#312e81 55%,#4c1d95 100%);` +
    `font-family:'PingFang SC','Microsoft YaHei',system-ui,sans-serif;">` +
    `<div style="font-size:40px;letter-spacing:4px;color:#c7d2fe;">一起AI · 小红书笔记</div>` +
    `<div style="font-size:92px;font-weight:700;line-height:1.3;color:#ffffff;">${t}</div>` +
    `<div style="font-size:38px;color:#a5b4fc;">17aitech.com · AI 工程实战</div>` +
    `</div>`
  );
}

export const saveXhsDraftTool = tool(
  async ({ post_id, title, content, tags }) => {
    // 码点硬闸(超限中文回话,模型自纠;tool_args_feedback 管线兜底)
    const tLen = [...title].length;
    const cLen = [...content].length;
    if (tLen < 1 || tLen > XHS_TITLE_MAX) {
      return JSON.stringify({
        ok: false,
        error: `标题需 1-${XHS_TITLE_MAX} 字(当前 ${tLen}),请调整后重新调用`,
      });
    }
    if (cLen < 100 || cLen > XHS_CONTENT_MAX) {
      return JSON.stringify({
        ok: false,
        error: `正文需 100-${XHS_CONTENT_MAX} 字(当前 ${cLen}),请调整后重新调用`,
      });
    }
    const cleanTags = tags
      .map((t) => t.trim().replace(/^#/, ""))
      .filter((t) => t !== "")
      .slice(0, XHS_TAGS_MAX);
    if (cleanTags.length < 3) {
      return JSON.stringify({ ok: false, error: "话题标签需至少 3 个,请补充后重新调用" });
    }
    const postId = BigInt(post_id);
    const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
    if (!post) return JSON.stringify({ ok: false, error: "文章不存在" });

    try {
      const rendered = await renderCardPng(coverHtml(title), {
        width: 1080,
        maxHeight: 1440,
      });
      const coverMediaPath = `xhs/${postId.toString()}/cover.png`;
      await mediaStorage.put(coverMediaPath, rendered.png);
      const row = await ensureChannelRowUnique(
        () =>
          prisma.publishChannel.findUnique({
            where: { postId_channel: { postId, channel: CHANNEL_XHS } },
          }),
        () => prisma.publishChannel.create({ data: { postId, channel: CHANNEL_XHS } }),
      );
      const prev = (row.data ?? {}) as { noteUrl?: string };
      await prisma.publishChannel.update({
        where: { id: row.id },
        data: {
          status: PUBLISH_STATUS_READY,
          title,
          lastError: null,
          data: {
            draft: { title, content, tags: cleanTags },
            coverMediaPath,
            readyAt: new Date().toISOString(),
            ...(prev.noteUrl ? { noteUrl: prev.noteUrl } : {}),
          },
        },
      });
      return JSON.stringify({
        ok: true,
        message: "物料已就绪:用户可在文章列表的小红书弹窗查看并回填发布链接",
      });
    } catch (e) {
      return JSON.stringify({
        ok: false,
        error: `物料保存失败:${e instanceof Error ? e.message : String(e)}`,
      });
    }
  },
  {
    name: "save_xhs_draft",
    description:
      "把改写好的小红书笔记(标题/正文/话题标签)保存为指定文章的分发物料,并自动渲染 3:4 封面卡。标题 1-20 字、正文 100-1000 字、话题 3-6 个。",
    schema: z.object({
      post_id: z.string().regex(/^\d+$/).describe("文章 id(纯数字字符串)"),
      title: z.string().describe(`笔记标题(≤${XHS_TITLE_MAX} 字,可含 1 个 emoji)`),
      content: z
        .string()
        .describe(`笔记正文(${XHS_CONTENT_MAX} 字以内,口语化短段落,适度 emoji,结尾互动引导)`),
      tags: z.array(z.string()).describe(`话题标签 3-${XHS_TAGS_MAX} 个(不带 # 号)`),
    }),
  },
);

export const XHS_TOOLS = [saveXhsDraftTool];
