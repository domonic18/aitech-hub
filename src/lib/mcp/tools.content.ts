/**
 * MCP 文章侧工具表(M72):创作面 + 文章分发。
 *
 * 创作面沿用 M5-c 口径:直调 service 层(upsert_article → upsertArticle()、
 * upload_media → uploadMedia()),一律以 slug 为文章键(与 HTTP 核 /api/posts 同形)。
 * M71(K3 复活)收紧:publish/unpublish 工具退役、upsert_article 恒落草稿
 * (发布/下架只走后台人工通道)。
 */
import { z } from "zod";

import { upsertArticle } from "@/lib/content/publish-api";
import { publishUpsertShape } from "@/lib/content/publish-schema";
import { ADMIN_LIST_SEGMENTS } from "@/lib/content/post-schema";
import {
  getPostBySlugAdmin,
  listPostsAdmin,
  parsePostId,
  ADMIN_ORIGIN_FILTERS,
} from "@/lib/content/posts-admin";
import {
  distributeJobResult,
  DISTRIBUTE_JOB_ID_RE,
  DISTRIBUTE_TOKEN_RE,
  mapDistributeJobState,
} from "@/lib/distribute/job-query";
import { enqueueWechatCopy, enqueueWechatSync } from "@/lib/distribute/wechat-sync";
import { renderWechatPreview } from "@/lib/distribute/wechat-preview";
import { WECHAT_THEME_IDS } from "@/lib/distribute/wechat-themes";
import { logger } from "@/lib/logger";
import { uploadMedia } from "@/lib/media/service";
import { getQueue, QUEUE_DISTRIBUTE } from "@/lib/queue";
import { isBigIntId } from "@/lib/http/parse-id";

import { fail, json } from "./json";
import { defineTool, type McpToolDef } from "./registry";

/** BigInt 主键入参(纯数字字符串;service 层转 BigInt) */
const POST_ID = z.string().refine(isBigIntId, "id 须为纯数字字符串(不超 int64 上限)");

/** BigInt→toString 的文章投影(MCP 出参不含 BigInt) */
function postView(p: {
  id: bigint;
  slug: string | null;
  title: string;
  status: string;
  publishedAt: Date | null;
  updatedAt: Date;
  category: { slug: string; name: string } | null;
  tags: Array<{ tag: { name: string; slug?: string } }>;
  contentMd?: string | null;
}) {
  return {
    id: p.id.toString(),
    slug: p.slug,
    title: p.title,
    status: p.status,
    category: p.category?.slug ?? null,
    tags: p.tags.map((t) => t.tag.name),
    publishedAt: p.publishedAt?.toISOString() ?? null,
    updatedAt: p.updatedAt.toISOString(),
    ...(p.contentMd !== undefined ? { contentMd: p.contentMd } : {}),
  };
}

/** 文章侧工具表(创作面 4 只) */
export const contentTools: McpToolDef[] = [
  defineTool(
    "upsert_article",
    "按 slug 幂等写入文章(markdown 可含 frontmatter)。**产出恒落草稿**,由站长在后台审核后发布" +
      "(无直发通道)。正文图片引用已上传的 /wp-content/uploads/ 站内路径或外链,勿随文传 base64" +
      "(images 参数仅为小图场景保留,总体积受代理层限制)。产出默认带 ai_assisted 合规标识。",
    // 入参约束与 HTTP PUT /api/posts 同源(publish-schema 单一事实源)
    publishUpsertShape,
    async (args, actor) => {
      try {
        const result = await upsertArticle({ ...args, actor });
        return json(result);
      } catch (e) {
        return fail(e);
      }
    },
  ),

  defineTool(
    "upload_media",
    "上传单张小图入库(base64 入参会经模型上下文,仅限 <100KB),返回站内路径;大图/批量用 curl 直传 POST /api/media/(字段 file,Bearer 用同一枚 PAT,≤10MB/张)取 data.path",
    {
      name: z.string().min(1).max(255),
      mime: z.string().regex(/^image\//),
      dataBase64: z.string().min(1),
    },
    async (args, actor) => {
      try {
        const data = new Uint8Array(Buffer.from(args.dataBase64, "base64"));
        const saved = await uploadMedia({ data, mime: args.mime, filename: args.name });
        logger.info({ event: "mcp.upload_media", actor, id: saved.id, reused: saved.reused });
        return json(saved);
      } catch (e) {
        return fail(e);
      }
    },
  ),

  defineTool(
    "get_article",
    "按 slug 取文章(含正文 markdown;软删视为不存在)",
    { slug: z.string().min(1) },
    async (args, actor) => {
      const post = await getPostBySlugAdmin(args.slug);
      // 读侧也入审计(2026-10-29 P3-3):同一枚 PAT 既能写也能读,取证时要
      // 能回答「这枚 token 什么时候把哪篇文章拉走过」;只记键与命中,不记正文
      logger.info({
        event: "mcp.get_article",
        actor,
        slug: args.slug,
        found: post !== null,
      });
      if (!post) return json({ error: "not found", slug: args.slug }, true);
      return json(postView({ ...post, contentMd: post.contentMd }));
    },
  ),

  defineTool(
    "list_articles",
    "列文章(不含正文;status: all|published|draft|unpublished,q 模糊匹配标题/slug," +
      "origin: all|human|ai_assisted|ai_generated 按创作方式筛——AI 稿恒落草稿,查自己的产出用 origin=ai_assisted)",
    {
      status: z.enum(ADMIN_LIST_SEGMENTS).default("all"),
      q: z.string().max(100).optional(),
      origin: z.enum(ADMIN_ORIGIN_FILTERS).default("all"),
      page: z.number().int().min(1).default(1),
    },
    async (args, actor) => {
      const { items, total } = await listPostsAdmin({
        page: args.page,
        segment: args.status,
        q: args.q,
        origin: args.origin,
      });
      // 读侧审计(2026-10-29 P3-3):记筛选条件与命中量,不记行内容
      logger.info({
        event: "mcp.list_articles",
        actor,
        status: args.status,
        q: args.q ?? null,
        origin: args.origin,
        page: args.page,
        total,
      });
      return json({
        total,
        page: args.page,
        list: items.map((p) =>
          postView({
            id: p.id,
            slug: p.slug,
            title: p.title,
            status: p.status,
            publishedAt: p.publishedAt,
            updatedAt: p.updatedAt,
            category: p.category,
            tags: p.tags,
          }),
        ),
      });
    },
  ),

  defineTool(
    "sync_article_to_wechat",
    "把文章推成公众号图文草稿(进草稿箱,不直接发布)。前置:正文是 Markdown(旧文 HTML 保真" +
      "的须先转写)、有封面。title/digest/coverPath/theme 可覆盖本次推送(单篇覆盖,不落库)。" +
      "返回 jobId + token,用 get_distribute_job 轮询。已在同步队列中的文章会被拒(勿重试风暴)。",
    {
      postId: POST_ID,
      title: z.string().max(200).optional().describe("本次推送的标题(缺省用文章标题)"),
      digest: z.string().max(500).optional().describe("本次推送的摘要(缺省不填)"),
      coverPath: z.string().max(500).optional().describe("封面站内路径;缺省用文章封面"),
      theme: z.enum(WECHAT_THEME_IDS).optional().describe("正文主题;缺省用渠道默认"),
    },
    async (args, actor) => {
      const id = parsePostId(args.postId);
      if (id === null) return json({ error: "文章 id 非法" }, true);
      try {
        const { jobId, token } = await enqueueWechatSync(id, {
          ...(args.title !== undefined ? { title: args.title } : {}),
          ...(args.digest !== undefined ? { digest: args.digest } : {}),
          ...(args.coverPath !== undefined ? { coverPath: args.coverPath } : {}),
          ...(args.theme !== undefined ? { theme: args.theme } : {}),
        });
        logger.info({ event: "mcp.sync_article_to_wechat", actor, postId: args.postId, jobId });
        return json({ jobId, token });
      } catch (e) {
        return fail(e);
      }
    },
  ),

  defineTool(
    "copy_article_wechat_format",
    "把文章的正文复制成公众号草稿(只取格式不发布:不动草稿状态机、不置 pending,与" +
      "sync_article_to_wechat 是两条独立通道)。前置:正文是 Markdown。与同步通道共享素材库" +
      "去重(同一张图不重复上传)。返回 jobId + token,用 get_distribute_job 轮询。",
    {
      postId: POST_ID,
      coverPath: z.string().max(500).optional().describe("封面站内路径;缺省不带封面"),
      theme: z.enum(WECHAT_THEME_IDS).optional().describe("正文主题;缺省用渠道默认"),
    },
    async (args, actor) => {
      const id = parsePostId(args.postId);
      if (id === null) return json({ error: "文章 id 非法" }, true);
      try {
        const { jobId, token } = await enqueueWechatCopy(id, {
          ...(args.coverPath !== undefined ? { coverPath: args.coverPath } : {}),
          ...(args.theme !== undefined ? { theme: args.theme } : {}),
        });
        logger.info({ event: "mcp.copy_article_wechat_format", actor, postId: args.postId, jobId });
        return json({ jobId, token });
      } catch (e) {
        return fail(e);
      }
    },
  ),

  defineTool(
    "get_distribute_job",
    "轮询分发任务进度(sync_article_to_wechat / copy_article_wechat_format / " +
      "sync_pin_to_wechat 返回的 jobId + token)。token 必须与任务匹配,否则查不到。" +
      "state: waiting|active|completed|failed;completed 时带 ok 与 mediaId(公众号草稿媒体 id)," +
      "失败时带人话 reason。",
    {
      jobId: z.string().regex(DISTRIBUTE_JOB_ID_RE, "jobId 格式不合法"),
      token: z.string().regex(DISTRIBUTE_TOKEN_RE, "token 缺失或不合法"),
    },
    async (args, actor) => {
      const job = await getQueue(QUEUE_DISTRIBUTE).getJob(args.jobId);
      if (!job || (job.data as { token?: string } | null)?.token !== args.token) {
        logger.info({ event: "mcp.get_distribute_job", actor, jobId: args.jobId, found: false });
        return json({ error: "任务不存在或已清理" }, true);
      }
      const state = mapDistributeJobState(await job.getState());
      if (state === "completed") {
        const r = distributeJobResult(job);
        logger.info({ event: "mcp.get_distribute_job", actor, jobId: args.jobId, state });
        return json({ state, ...r });
      }
      if (state === "failed") {
        logger.info({ event: "mcp.get_distribute_job", actor, jobId: args.jobId, state });
        return json({
          state,
          ok: false,
          mediaId: null,
          reason: (job.failedReason ?? "").slice(0, 300),
        });
      }
      logger.info({ event: "mcp.get_distribute_job", actor, jobId: args.jobId, state });
      return json({ state, ok: null, mediaId: null, reason: null });
    },
  ),

  defineTool(
    "render_wechat_preview",
    "渲染文章在公众号的正文 HTML(与最终草稿同源:同一主题、同一段落排版、同一尾注)," +
      "可用于发给主人预览。主题优先级:入参指定 > 该文章渠道行快照 > 渠道默认。旧文" +
      "(HTML 保真正文)不支持,须先转写为 Markdown。",
    {
      postId: POST_ID,
      theme: z.enum(WECHAT_THEME_IDS).optional().describe("正文主题;缺省按渠道行快照 → 渠道默认"),
    },
    async (args, actor) => {
      const id = parsePostId(args.postId);
      if (id === null) return json({ error: "文章 id 非法" }, true);
      try {
        const result = await renderWechatPreview(id, args.theme);
        logger.info({
          event: "mcp.render_wechat_preview",
          actor,
          postId: args.postId,
          theme: result.theme,
        });
        return json(result);
      } catch (e) {
        return fail(e);
      }
    },
  ),
];
