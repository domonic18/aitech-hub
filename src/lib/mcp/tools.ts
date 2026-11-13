/**
 * MCP 工具集(M5-c,requirement §3.6「MCP 为壳」):创作面工具直调 service 层,
 * 一律以 slug 为文章键(HTTP 核形态见 /api/posts)。每请求新建 server 实例
 * (stateless,配合容器多实例),actor 闭包进审计日志。
 *
 * 注册方式(2026-10-29 P3-3):维持逐只显式 server.tool 调用——入参 Zod 形状
 * 与工具名就地可读,声明式表反而把 schema 与 handler 拉远。触发条件写明:
 * 工具数破 10 只时改声明式注册(单表登记 name/description/schema/handler)。
 *
 * M71(K3 复活):只读面在 read-tools.ts 单独注册(同端点同 PAT);创作面
 * 收紧——publish/unpublish 工具退役、upsert_article 恒落草稿(发布/下架
 * 只走后台人工通道)。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AdminActor } from "@/lib/http/mutation-guard";
import { upsertArticle } from "@/lib/content/publish-api";
import { publishUpsertShape } from "@/lib/content/publish-schema";
import { ADMIN_LIST_SEGMENTS } from "@/lib/content/post-schema";
import {
  getPostBySlugAdmin,
  listPostsAdmin,
  ADMIN_ORIGIN_FILTERS,
} from "@/lib/content/posts-admin";
import { uploadMedia } from "@/lib/media/service";
import { logger } from "@/lib/logger";

import { fail, json } from "./json";
import { registerReadTools } from "./read-tools";

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
 * 模型上下文——带图文章走 curl multipart 整包上传 /api/posts/bundle,单图走
 * /api/media 直传;MCP 只承担文本编排。任何 agent(codex/workbuddy/claude)
 * 连上 tools/list 即知。
 *
 * M71:产出**恒落草稿**,发布/下架只走后台人工通道(无直发工具);产出默认带
 * ai_assisted 合规标识,后台草稿池可按「AI 稿」筛出待审。
 */
const SERVER_INSTRUCTIONS = [
  "发文工作流(带图文章,适用任意 agent):",
  "0. 带图文章首选整包上传(一次调用,图片字节不过模型):",
  '   curl -H "Authorization: Bearer <PAT>" -F "md=@<文章.md>" -F "files=@<图1.png>" -F "files=@<图2.png>" <base>/api/posts/bundle/',
  "   md 正文里的本地引用(如 ./截图/x.png)按文件名自动匹配 files 并替换为站内路径;",
  "   frontmatter 的 cover: ./cover.png 同样自动入库作封面;单批图片 ≤30 张、单图 ≤10MB。",
  "1. 若走单图直传(逐张):",
  '   curl -H "Authorization: Bearer <PAT>" -F "file=@<图片路径>" <base>/api/media/',
  '   返回 202 {"data":{"path":"/wp-content/uploads/…"}};<PAT> 用连接本 MCP 的同一枚',
  "   Bearer token,<base> 为本 MCP 端点所属站点源(如 https://17aitech.com)。",
  "2. 把正文本地图引用(如 ./截图/x.png)改写为返回的 path。",
  "3. 调 upsert_article 传纯文本 markdown ——产出**恒落草稿**,由站长在后台审核后发布",
  "(M71 起无直发通道:没有 publish 参数,也没有 publish/unpublish 工具)。",
  "封面:markdown 头部 frontmatter 加 cover: <已上传的 /wp-content/uploads/… 路径>",
  "(仅认站内路径,外链被忽略;封面图不必在正文中引用)。",
  "文生图封面在 agent 侧本地生成后,按步骤 0/1 直传即可作封面素材。",
  "约束:单图 ≤10MB,jpg/png/webp/gif;sha1 去重,重跑返回 reused:true;",
  "仅 <100KB 小图可走 upload_media(base64 会占模型上下文,大图禁用)。",
  "取内容:list_hot_topics(当前热点) / search_site(按关键词检索) /",
  "get_telegram_item(单条资讯元数据) / get_video_play_url(视频直链)。",
].join("\n");

export function createMcpServer(actor: AdminActor): McpServer {
  const server = new McpServer(
    { name: "aitech-hub", version: "0.2.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  // 只读面(M71):同端点同 PAT,读写工具集一
  registerReadTools(server, actor);

  server.tool(
    "upsert_article",
    "按 slug 幂等写入文章(markdown 可含 frontmatter)。**产出恒落草稿**,由站长在后台审核后发布" +
      "(无直发通道)。正文图片引用已上传的 /wp-content/uploads/ 站内路径或外链,勿随文传 base64" +
      "(images 参数仅为小图场景保留,总体积受代理层限制)。产出默认带 ai_assisted 合规标识。",
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
  );

  server.tool(
    "list_articles",
    "列文章(不含正文;status: all|published|draft|unpublished,q 模糊匹配标题/slug," +
      "origin: all|human|ai_assisted|ai_generated 按创作方式筛——AI 稿恒落草稿,查自己的产出用 origin=ai_assisted)",
    {
      status: z.enum(ADMIN_LIST_SEGMENTS).default("all"),
      q: z.string().max(100).optional(),
      origin: z.enum(ADMIN_ORIGIN_FILTERS).default("all"),
      page: z.number().int().min(1).default(1),
    },
    async (args) => {
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
  );

  return server;
}
