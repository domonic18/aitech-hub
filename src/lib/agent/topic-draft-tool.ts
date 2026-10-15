/**
 * save_topic_draft:专题落稿锚定工具(技术债批⑤ 自 topic-tools 拆出,④号工具)。
 * 落稿锚定核(标题/摘要/正文/封面/SEO/标签一次交付,已有关联文档时覆盖),
 * 含正文图片防幻觉校验(只认 /wp-content/uploads/)与 needConfirm→confirm
 * 覆盖确认回路;确定性写在 ../topics/compose#finalizeCompose,本件只做
 * admin 防线 + 入参校验 + 结果透传。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { POST_LIMITS } from "../content/post-schema";
import { prisma } from "../db";
import {
  buildComposeBlocks,
  finalizeCompose,
  isPostAdminError,
  needsRecomposeConfirm,
} from "../topics/compose";
import { getTopic } from "../topics/repo";
import { findNonSiteImageRefs, isUploadsPath } from "../media/refs";
import { logger } from "../logger";

import { assertAdminThread } from "./admin-thread";
import { denyPayload, humanizeTopicError } from "./topic-tool-common";

const IMG_RULE_HINT =
  "正文图片只可引用站内媒体路径(/wp-content/uploads/ 开头,来自 " +
  "transfer_video_cover / generate_cover_candidates 的返回),不要编造外链图片";

export const saveTopicDraftTool = tool(
  async (
    { topic_id, title, excerpt, content_md, cover_path, seo_title, seo_description, tags, confirm },
    config,
  ) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return denyPayload(config?.configurable?.thread_id);
    const badRefs = findNonSiteImageRefs(content_md);
    if (badRefs.length > 0) {
      return JSON.stringify({
        ok: false,
        error: `${IMG_RULE_HINT};发现无效引用:${badRefs.slice(0, 5).join("、")}`,
      });
    }
    if (cover_path !== undefined && !isUploadsPath(cover_path)) {
      return JSON.stringify({ ok: false, error: `cover_path ${IMG_RULE_HINT}` });
    }
    try {
      const topic = await getTopic(BigInt(topic_id));
      if (topic.items.length === 0) {
        return JSON.stringify({ ok: false, error: "专题还没有素材,无法成文——先挂载解读/文章" });
      }
      const linked =
        topic.linkedPostId !== null
          ? await prisma.post.findUnique({
              where: { id: topic.linkedPostId },
              select: { status: true, updatedAt: true },
            })
          : null;
      if (
        !confirm &&
        linked &&
        linked.status !== "deleted" &&
        needsRecomposeConfirm(topic, linked)
      ) {
        return JSON.stringify({
          ok: false,
          needConfirm: true,
          error:
            "关联文档在落稿后被人工编辑过,保存将覆盖这些改动——先用 ask_user 向管理员确认" +
            "是否覆盖,同意后带 confirm=true 重新调用本工具",
        });
      }
      const tagList = (tags ?? []).map((t) => t.trim()).filter((t) => t !== "");
      const outcome = await finalizeCompose(
        topic,
        {
          title: title.trim().slice(0, POST_LIMITS.title),
          excerpt: excerpt.trim().slice(0, POST_LIMITS.excerpt),
          contentMd: content_md.slice(0, POST_LIMITS.contentMd),
        },
        await buildComposeBlocks(topic),
        cover_path ?? null,
        {
          seoTitle: seo_title === undefined ? undefined : seo_title.slice(0, POST_LIMITS.seoTitle),
          seoDescription:
            seo_description === undefined
              ? undefined
              : seo_description.slice(0, POST_LIMITS.seoDescription),
          tags: tagList.length > 0 ? tagList.slice(0, POST_LIMITS.tagsMax) : undefined,
        },
      );
      logger.info({
        event: "agent.topic_draft_saved",
        topicId: topic.id.toString(),
        postId: outcome.postId.toString(),
        recomposed: outcome.recomposed,
      });
      return JSON.stringify({
        ok: true,
        post_id: outcome.postId.toString(),
        post_title: outcome.postTitle,
        post_url: `/admin/posts/${outcome.postId.toString()}`,
        recomposed: outcome.recomposed,
        cover_path: outcome.coverPath,
      });
    } catch (e) {
      const msg = humanizeTopicError(e);
      if (msg) return JSON.stringify({ ok: false, error: msg });
      if (isPostAdminError(e)) return JSON.stringify({ ok: false, error: e.message });
      throw e;
    }
  },
  {
    name: "save_topic_draft",
    description:
      "把写好的专题文章落库为文章管理草稿并锚定到专题(标题/摘要/正文/封面/SEO/标签" +
      "一次交付;已有关联文档时覆盖)。返回 post_url 后向管理员汇报文档链接。规则:" +
      `${IMG_RULE_HINT};返回 needConfirm 时必须先用 ask_user 征得管理员确认,再带 ` +
      "confirm=true 重新调用;正文用 markdown,系统会在文首自动注入视频推荐卡。",
    schema: z.object({
      topic_id: z
        .string()
        .regex(/^\d{1,10}$/)
        .describe("专题 id(专题管理详情页 URL 中的数字 id)"),
      title: z
        .string()
        .trim()
        .min(1)
        .max(POST_LIMITS.title)
        .describe("文章标题(≤30 字为宜,像公众号好标题)"),
      excerpt: z
        .string()
        .trim()
        .max(POST_LIMITS.excerpt)
        .describe("摘要(≤120 字,一句话说清推荐什么、为什么值得看)"),
      content_md: z
        .string()
        .min(1)
        .max(POST_LIMITS.contentMd)
        .describe("正文全文(markdown;800~1200 字推荐短文)"),
      cover_path: z
        .string()
        .trim()
        .max(POST_LIMITS.coverPath)
        .optional()
        .describe("封面图站内路径(transfer_video_cover 或 generate_cover_candidates 的返回)"),
      seo_title: z
        .string()
        .trim()
        .max(POST_LIMITS.seoTitle)
        .optional()
        .describe("SEO 标题(省略则不动既有值)"),
      seo_description: z
        .string()
        .trim()
        .max(POST_LIMITS.seoDescription)
        .optional()
        .describe("SEO 描述(省略则不动既有值)"),
      tags: z
        .array(z.string().trim().min(1).max(POST_LIMITS.tag))
        .max(POST_LIMITS.tagsMax)
        .optional()
        .describe("标签(≤5 个;省略则新建时用专题标题兜底)"),
      confirm: z
        .boolean()
        .default(false)
        .describe("覆盖确认;仅在本工具返回 needConfirm 且管理员经 ask_user 同意后置 true"),
    }),
  },
);
