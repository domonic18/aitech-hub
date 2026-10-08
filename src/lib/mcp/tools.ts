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

/**
 * 发文工作流自解释(随 initialize 下发,MCP 标准字段):二进制图片字节永不进
 * 模型上下文——大图走 curl multipart 直传 /api/media(PAT 双通道鉴权已内置),
 * MCP 只承担文本编排。任何 agent(codex/workbuddy/claude)连上 tools/list 即知。
 */
const SERVER_INSTRUCTIONS = [
  "发文工作流(带图文章,适用任意 agent):",
  "1. 每张本地图先二进制直传(字节不过模型):",
  '   curl -H "Authorization: Bearer <PAT>" -F "file=@<图片路径>" <base>/api/media/',
  '   返回 202 {"data":{"path":"/wp-content/uploads/…"}};<PAT> 用连接本 MCP 的同一枚',
  "   Bearer token,<base> 为本 MCP 端点所属站点源(如 https://17aitech.com)。",
  "2. 把正文本地图引用(如 ./截图/x.png)改写为返回的 path。",
  "3. 调 upsert_article 传纯文本 markdown(默认落草稿,publish=true 直发)。",
  "封面:markdown 头部 frontmatter 加 cover: <已上传的 /wp-content/uploads/… 路径>",
  "(仅认站内路径,外链被忽略;封面图不必在正文中引用)。",
  "文生图封面在 agent 侧本地生成后,按步骤 1 直传即可作封面素材。",
  "约束:单图 ≤10MB,jpg/png/webp/gif;sha1 去重,重跑返回 reused:true;",
  "仅 <100KB 小图可走 upload_media(base64 会占模型上下文,大图禁用)。",
].join("\n");

export function createMcpServer(actor: AdminActor): McpServer {
  const server = new McpServer(
    { name: "aitech-hub", version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.tool(
    "upsert_article",
    "按 slug 幂等发布文章(markdown 可含 frontmatter;默认落草稿,publish=true 直发)。正文图片引用已上传的 /wp-content/uploads/ 站内路径或外链,勿随文传 base64(images 参数仅为小图场景保留,总体积受代理层限制)",
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
    "上传单张小图入库(base64 入参会经模型上下文,仅限 <100KB),返回站内路径;大图/批量用 curl 直传 POST /api/media/(字段 file,Bearer 用同一枚 PAT,≤10MB/张)取 data.path",
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
