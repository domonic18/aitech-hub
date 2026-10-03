/**
 * MCP 工具集(M5-c,requirement §3.6「MCP 为壳」):六工具直调 service 层,
 * 一律以 slug 为文章键(HTTP 核形态见 /api/posts)。每请求新建 server 实例
 * (stateless,配合容器多实例),actor 闭包进审计日志。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AdminActor } from "@/lib/http/mutation-guard";
import { upsertArticle } from "@/lib/content/publish-api";
import { publishUpsertShape } from "@/lib/content/publish-schema";
import {
  getPostBySlugAdmin,
  listPostsAdmin,
  publishPost,
  unpublishPost,
} from "@/lib/content/posts-admin";
import { uploadMedia } from "@/lib/media/service";
import { logger } from "@/lib/logger";

/** 工具出参统一 JSON 文本;失败置 isError(Claude 侧按错误呈现) */
function json(value: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], isError };
}

function fail(e: unknown) {
  return json({ error: e instanceof Error ? e.message : String(e) }, true);
}

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

export function createMcpServer(actor: AdminActor): McpServer {
  const server = new McpServer({ name: "aitech-hub", version: "0.1.0" });

  server.tool(
    "upsert_article",
    "按 slug 幂等发布文章(markdown 可含 frontmatter;默认落草稿,publish=true 直发;本地图片随文 base64 上传,外链保留原链)",
    // 入参约束与 HTTP PUT /api/posts 同源(publish-schema 单一事实源)
    publishUpsertShape,
    async (args) => {
      try {
        const result = await upsertArticle({ ...args, actor });
        return json(result);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "upload_media",
    "上传单张图片入库(sha1 去重),返回站内路径;与 upsert_article 的 images 随文通道二选一",
    {
      name: z.string().min(1).max(255),
      mime: z.string().regex(/^image\//),
      dataBase64: z.string().min(1),
    },
    async (args) => {
      try {
        const data = new Uint8Array(Buffer.from(args.dataBase64, "base64"));
        const saved = await uploadMedia({ data, mime: args.mime, filename: args.name });
        logger.info({ event: "mcp.upload_media", actor, id: saved.id, reused: saved.reused });
        return json(saved);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "get_article",
    "按 slug 取文章(含正文 markdown;软删视为不存在)",
    { slug: z.string().min(1) },
    async (args) => {
      const post = await getPostBySlugAdmin(args.slug);
      if (!post) return json({ error: "not found", slug: args.slug }, true);
      return json(postView({ ...post, contentMd: post.contentMd }));
    },
  );

  server.tool(
    "list_articles",
    "列文章(不含正文;status: all|published|draft|unpublished,q 模糊匹配标题/slug)",
    {
      status: z.enum(["all", "published", "draft", "unpublished"]).default("all"),
      q: z.string().max(100).optional(),
      page: z.number().int().min(1).default(1),
    },
    async (args) => {
      const { items, total } = await listPostsAdmin({
        page: args.page,
        segment: args.status,
        q: args.q,
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
  );

  server.tool(
    "publish",
    "按 slug 发布(首次发布落 publishedAt)",
    { slug: z.string().min(1) },
    async (args) => {
      const post = await getPostBySlugAdmin(args.slug);
      if (!post) return json({ error: "not found", slug: args.slug }, true);
      const r = await publishPost(post.id);
      logger.info({ event: "mcp.publish", actor, slug: args.slug });
      return json({ slug: args.slug, id: post.id.toString(), urlSlug: r.slug });
    },
  );

  server.tool(
    "unpublish",
    "按 slug 下架(回草稿保留 publishedAt,前台不可见)",
    { slug: z.string().min(1) },
    async (args) => {
      const post = await getPostBySlugAdmin(args.slug);
      if (!post) return json({ error: "not found", slug: args.slug }, true);
      const r = await unpublishPost(post.id);
      logger.info({ event: "mcp.unpublish", actor, slug: args.slug });
      return json({ slug: args.slug, id: post.id.toString(), urlSlug: r.slug });
    },
  );

  return server;
}
