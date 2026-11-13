/**
 * MCP 工具集(M5-c,requirement §3.6「MCP 为壳」):创作面工具直调 service 层,
 * 一律以 slug 为文章键(HTTP 核形态见 /api/posts)。每请求新建 server 实例
 * (stateless,配合容器多实例),actor 闭包进审计日志。
 *
 * 注册方式(M72,2026-11-13):改为声明式工具表(registry.ts 的 defineTool +
 * 三张分域表),不再逐只 server.tool 调用——工具数从 8 只扩到 21 只后,
 * 逐只显式注册会让「工具名/入参/handler」散落多处、难维护。
 * 同时换用 SDK 1.32 官方的 registerTool(server.tool 已标 @deprecated)。
 *
 * M71(K3 复活):只读面与创作面同一端点同一 PAT;创作面收紧——
 * publish/unpublish 工具退役、upsert_article 恒落草稿(发布/下架
 * 只走后台人工通道)。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AdminActor } from "@/lib/http/mutation-guard";

import { registerTools } from "./registry";
import { contentTools } from "./tools.content";
import { feedTools } from "./tools.feed";

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

  // 只读面与创作面同一端点同一 PAT,读写工具集一
  registerTools(server, actor, feedTools);
  registerTools(server, actor, contentTools);

  return server;
}
