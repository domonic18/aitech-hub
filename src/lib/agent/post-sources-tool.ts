/**
 * get_post_sources·文章素材反查(2026-10-18 post-319 验收反馈):文章编辑
 * 上下文里只有 post id,而素材唯一入口 get_topic_brief 必须给专题 id——编排
 * 模型无从得知 post→topic 反查路径,「根据原始素材重写」不可达(实证对话:
 * agent 只能 read_draft 读正文,答「原始材料是抖音视频」)。本工具补上
 * post→topic(经 linked_post_id)→挂载素材 的只读直通车:解读笔记全文、
 * 人工批注、视频地址、文章节选一次带回。纯读零副作用(与 get_topic_brief
 * 的分工:brief 是「生产底料装配」含封面转存,本工具是「素材查阅」)。
 * admin 专属,纵深防御同 topic 域(assertAdminThread)。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { prisma } from "../db";
import { buildComposeBlocks } from "../topics/compose";
import { logger } from "../logger";

import { assertAdminThread } from "./admin-thread";
import { BRIEF_NOTE_MAX, denyPayload } from "./topic-tool-common";

export const postSourcesTool = tool(
  async ({ post_id }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return denyPayload(config?.configurable?.thread_id);
    try {
      const pid = BigInt(post_id);
      const post = await prisma.post.findUnique({
        where: { id: pid },
        select: { id: true, title: true, status: true },
      });
      if (!post) {
        return JSON.stringify({ ok: false, error: `文章 ${post_id} 不存在` });
      }
      const topic = await prisma.topic.findFirst({
        where: { linkedPostId: pid },
        orderBy: { updatedAt: "desc" },
        include: { items: true },
      });
      if (!topic) {
        return JSON.stringify({
          ok: false,
          error:
            "这篇文章没有关联专题(非合成产物),查不到素材关联;原始素材在电报管理时," +
            "请管理员提供创作 id 用 get_topic_brief,或先在创作中心挂载素材后创作",
        });
      }
      const blocks = await buildComposeBlocks(topic);
      if (blocks.length === 0) {
        return JSON.stringify({
          ok: false,
          error: `关联创作《${topic.title}》(id:${topic.id})还没有挂载素材,先到创作中心挂载`,
        });
      }
      logger.info({ event: "agent.post_sources_ok", postId: post_id, topicId: topic.id });
      return JSON.stringify({
        ok: true,
        topic: {
          id: topic.id.toString(),
          title: topic.title,
          positioning: topic.positioning,
          skill_key: topic.skillKey,
          status: topic.status,
          admin_url: `/admin/studio/${topic.id.toString()}`,
        },
        linked_post: { id: post.id.toString(), title: post.title, status: post.status },
        materials: blocks.map((b) => ({
          kind: b.kind,
          media_type: b.mediaType,
          title: b.title,
          blogger: b.blogger,
          note: b.note,
          video_url: b.videoUrl,
          ...(b.aiTopic !== null ? { ai_topic: b.aiTopic } : {}),
          ...(b.keywords.length > 0 ? { keywords: b.keywords } : {}),
          ...(b.aiNote !== null
            ? { note_md: b.aiNote.slice(0, BRIEF_NOTE_MAX) }
            : { summary: b.aiSummary ?? b.summary, points: b.aiPoints }),
          excerpt: b.excerpt,
          content_sample: b.contentSample,
        })),
        note: "materials[].note=人工批注,note_md=解读笔记全文(原始素材底料);改稿/重写以这些为准,严禁编造素材里没有的内容",
      });
    } catch (e) {
      // BigInt 解析失败等入参异常归人话;其余原样上抛由 run 层收束
      if (e instanceof SyntaxError || e instanceof RangeError) {
        return JSON.stringify({ ok: false, error: "post_id 非法(应为纯数字 id)" });
      }
      throw e;
    }
  },
  {
    name: "get_post_sources",
    description:
      "反查一篇文章的原始素材(经关联专题):专题定位、挂载素材(解读笔记全文/" +
      "人工批注/视频地址/站内文章节选)。文章编辑上下文(只有 post id)要按原始" +
      "素材改稿/重写时必调;已知专题 id 时用 get_topic_brief(还带封面转存分配面)。",
    schema: z.object({
      post_id: z
        .string()
        .regex(/^\d{1,10}$/)
        .describe("文章 id(文章编辑页 URL 中的数字 id)"),
    }),
  },
);

export const POST_SOURCES_TOOLS = [postSourcesTool];
