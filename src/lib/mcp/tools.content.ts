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
  ADMIN_ORIGIN_FILTERS,
} from "@/lib/content/posts-admin";
import { logger } from "@/lib/logger";
import { uploadMedia } from "@/lib/media/service";

import { fail, json } from "./json";
import { defineTool, type McpToolDef } from "./registry";

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
];
