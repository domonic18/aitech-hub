/**
 * 专题文章生产·admin 细粒度工具面(M27 批⑤建;批⑥补正文配图分配面):
 * 编排权移交会话 agent——模型按系统提示工作流自主规划(write_todos)并逐工具
 * 执行:get_topic_brief(素材全集 + 封面已转存为站内路径的分配面)→
 * transfer_video_cover(全量封面转存,重试/补传钮)/ generate_cover_candidates
 * (文生图封面候选与概念示意图,复用 M14 cover-gen 管线)→ save_topic_draft
 * (落稿锚定核,含 SEO/标签与正文图片防幻觉校验,只认 /wp-content/uploads/)。
 * 过程可视性来自每只工具卡逐个出现,HITL 选题/覆盖确认走 ask_user。
 * 纵深防御:图侧工具按身份档分发(admin 独占)之外,每只工具体内再验会话行
 * 归属是 admin(fail-closed)。
 */
import { randomUUID } from "node:crypto";

import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { enqueueCoverGen, listCoverCandidates, loadCoverPostContext } from "../ai/cover-generate";
import { AiAdminError } from "../ai/errors";
import { POST_LIMITS } from "../content/post-schema";
import { prisma } from "../db";
import {
  buildComposeBlocks,
  finalizeCompose,
  isPostAdminError,
  listRecentPublishedTitles,
  needsRecomposeConfirm,
  transferVideoCovers,
} from "../topics/compose";
import { getTopic, TopicError } from "../topics/repo";
import { findNonSiteImageRefs, isUploadsPath } from "../media/refs";
import { logger } from "../logger";

import { adminThreadDeny, assertAdminThread } from "./admin-thread";
import { pollUntil } from "./poll";

/** brief 内单条解读笔记进上下文的截断宽度(素材多条叠加,单条给足不失真) */
const BRIEF_NOTE_MAX = 3000;

/** 纵深防御收口(M27 批⑧-b 上提 admin-thread 共用;deny 固定 topic 域) */
const denyPayload = (threadId: unknown): string => adminThreadDeny(threadId, "topic");

/** TopicError(不存在等)归人话;其余原样上抛由 run 层收束 */
function humanizeTopicError(e: unknown): string | null {
  return e instanceof TopicError ? e.message : null;
}

// ── ① get_topic_brief:专题定位 + 素材全集(分析底料)──────────────

export const getTopicBriefTool = tool(
  async ({ topic_id }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return denyPayload(config?.configurable?.thread_id);
    try {
      const topic = await getTopic(BigInt(topic_id));
      const blocks = await buildComposeBlocks(topic);
      // 批⑥分配面:brief 现场全量转存视频封面,站内路径直接进 payload(模型
      // 「看得到用得上」);单条失败置 null 不阻塞,失败清单顶层随附
      const coverAssets = await transferVideoCovers(blocks);
      let coverIdx = 0;
      const linkedId = topic.linkedPostId;
      const linked =
        linkedId !== null
          ? await prisma.post.findUnique({
              where: { id: linkedId },
              select: { title: true, status: true, updatedAt: true },
            })
          : null;
      return JSON.stringify({
        topic: {
          id: topic.id.toString(),
          title: topic.title,
          positioning: topic.positioning,
          status: topic.status,
          skill_key: topic.skillKey,
          composed_at: topic.composedAt?.toISOString() ?? null,
        },
        linked_post:
          linkedId !== null && linked && linked.status !== "deleted"
            ? {
                id: linkedId.toString(),
                title: linked.title,
                status: linked.status,
                admin_url: `/admin/posts/${linkedId.toString()}`,
                edited_since_compose: needsRecomposeConfirm(topic, linked),
              }
            : null,
        materials: blocks.map((b) => {
          const coverPath =
            b.kind === "telegram" && b.coverUrl !== null
              ? (coverAssets[coverIdx++]?.coverPath ?? null)
              : null;
          return {
            kind: b.kind,
            title: b.title,
            blogger: b.blogger,
            note: b.note,
            video_url: b.videoUrl,
            cover_path: coverPath,
            ...(b.aiNote !== null
              ? { note_md: b.aiNote.slice(0, BRIEF_NOTE_MAX) }
              : { summary: b.aiSummary, points: b.aiPoints }),
            excerpt: b.excerpt,
            content_sample: b.contentSample,
          };
        }),
        cover_transfer_failed: coverAssets.filter((a) => a.coverPath === null).map((a) => a.title),
        recent_published_titles: await listRecentPublishedTitles(),
      });
    } catch (e) {
      const msg = humanizeTopicError(e);
      if (msg) return JSON.stringify({ ok: false, error: msg });
      throw e;
    }
  },
  {
    name: "get_topic_brief",
    description:
      "读取专题的完整生产底料:专题定位、绑定技能(topic.skill_key,写前经 get_skill " +
      "取指南)、挂载素材(博主/视频/解读笔记/要点/人工批注/站内文章节选)、关联文档" +
      "现状(含是否被人工编辑过)与近期已发文章标题(防重复选题)。视频封面已自动转存" +
      "为站内路径(materials[].cover_path),可直接在正文引用。写专题文章前必调;仔细" +
      "分析素材后再选题与写作。",
    schema: z.object({
      topic_id: z
        .string()
        .regex(/^\d{1,10}$/)
        .describe("专题 id(专题管理详情页 URL 中的数字 id)"),
    }),
  },
);

// ── ② transfer_video_cover:视频封面转存入站内媒体库 ──────────────

export const transferVideoCoverTool = tool(
  async ({ topic_id }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return denyPayload(config?.configurable?.thread_id);
    try {
      const topic = await getTopic(BigInt(topic_id));
      const blocks = await buildComposeBlocks(topic);
      const assets = await transferVideoCovers(blocks);
      if (assets.length === 0) {
        return JSON.stringify({
          ok: false,
          error: "素材中没有视频封面图(可用 generate_cover_candidates 生成封面)",
        });
      }
      const covers = assets
        .filter((a) => a.coverPath !== null)
        .map((a) => ({ title: a.title, blogger: a.blogger, cover_path: a.coverPath }));
      if (covers.length === 0) {
        return JSON.stringify({
          ok: false,
          error: "封面转存全部失败(B 站图床防盗链、网络抖动或图片格式不支持),可稍后重试",
        });
      }
      const failed = assets.filter((a) => a.coverPath === null).map((a) => a.title);
      return JSON.stringify({ ok: true, covers, ...(failed.length > 0 ? { failed } : {}) });
    } catch (e) {
      const msg = humanizeTopicError(e);
      if (msg) return JSON.stringify({ ok: false, error: msg });
      throw e;
    }
  },
  {
    name: "transfer_video_cover",
    description:
      "转存专题全部视频素材封面入站内媒体库(B 站图床有防盗链,外链直引会裂图),返回" +
      "「标题/博主/站内路径」清单,部分失败列在 failed(标题)。brief 里 cover_path " +
      "为 null(转存失败)或 brief 之后新挂了素材时使用;返回的路径可作 " +
      "save_topic_draft 的 cover_path(文章头图/公众号大图),也可在正文中以图片语法引用。",
    schema: z.object({
      topic_id: z
        .string()
        .regex(/^\d{1,10}$/)
        .describe("专题 id(专题管理详情页 URL 中的数字 id)"),
    }),
  },
);

// ── ③ generate_cover_candidates:文生图封面候选(复用 M14 cover-gen)──

export const generateCoverCandidatesTool = tool(
  async ({ topic_id, prompt }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return denyPayload(config?.configurable?.thread_id);
    let token: string;
    try {
      const topic = await getTopic(BigInt(topic_id));
      // 关联稿正文一并供给(M31:agent 提示词步骤吃全文;无关联稿留空)
      const linkedCtx = topic.linkedPostId
        ? await loadCoverPostContext(topic.linkedPostId.toString())
        : null;
      ({ token } = await enqueueCoverGen({
        token: randomUUID(),
        postId: topic.linkedPostId?.toString() ?? null,
        title: topic.title,
        excerpt: topic.positioning ?? "",
        tags: [],
        contentMd: linkedCtx?.contentMd ?? "",
        prompt: prompt ?? "",
      }));
    } catch (e) {
      if (e instanceof AiAdminError || e instanceof TopicError) {
        return JSON.stringify({ ok: false, error: e.message });
      }
      throw e;
    }
    logger.info({ event: "agent.cover_gen_started", token });
    const paths = await pollUntil(async () => {
      const rows = await listCoverCandidates(token);
      return rows.length > 0 ? rows.map((r) => r.path) : null;
    });
    if (paths === null) {
      return JSON.stringify({
        ok: false,
        timeout: true,
        error: "封面生成超时(云厂商生图通常 10-30 秒),可重试或改用 transfer_video_cover",
      });
    }
    return JSON.stringify({
      ok: true,
      candidates: paths,
      note: "从候选中择优,路径可作正文配图或 save_topic_draft 的 cover_path",
    });
  },
  {
    name: "generate_cover_candidates",
    description:
      "用文生图模型为专题文章生成候选图(2 张,约 10-30 秒,本工具会等待到出图)," +
      "返回站内路径列表。可为封面,也可为正文小节现拟 prompt 生成概念示意图(不限于" +
      "封面);prompt 描述期望的画面主体与风格,省略则按专题标题自动生成。",
    schema: z.object({
      topic_id: z
        .string()
        .regex(/^\d{1,10}$/)
        .describe("专题 id(专题管理详情页 URL 中的数字 id)"),
      prompt: z
        .string()
        .trim()
        .max(1000)
        .optional()
        .describe("生图提示词(画面主体/风格);省略则按专题标题与定位自动生成"),
    }),
  },
);

// ── ④ save_topic_draft:落稿锚定(标题/摘要/正文/封面/SEO/标签)──────

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

export const TOPIC_TOOLS = [
  getTopicBriefTool,
  transferVideoCoverTool,
  generateCoverCandidatesTool,
  saveTopicDraftTool,
];
