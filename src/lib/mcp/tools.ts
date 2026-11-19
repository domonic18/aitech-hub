/**
 * MCP 工具集(M5-c,requirement §3.6「MCP 为壳」):创作面工具直调 service 层,
 * 一律以 slug 为文章键(HTTP 核形态见 /api/posts)。每请求新建 server 实例
 * (stateless,配合容器多实例),actor 闭包进审计日志。
 *
 * 注册方式(M72,2026-11-13):改为声明式工具表(registry.ts 的 defineTool +
 * 三张分域表),不再逐只 server.tool 调用——工具数从 8 只扩到 25 只后,
 * 逐只显式注册会让「工具名/入参/handler」散落多处、难维护。
 * 同时换用 SDK 1.32 官方的 registerTool(server.tool 已标 @deprecated)。
 *
 * M71(K3 复活):只读面与创作面同一端点同一 PAT;创作面收紧——
 * publish/unpublish 工具退役、upsert_article 恒落草稿(发布/下架
 * 只走后台人工通道)。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AdminActor } from "@/lib/http/mutation-guard";

import { registerTools, type McpToolDef } from "./registry";
import { contentTools } from "./tools.content";
import { feedTools } from "./tools.feed";
import { opsActionTools } from "./tools.ops.actions";
import { opsReadTools } from "./tools.ops";
import { pinTools } from "./tools.pins";

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
  "写作指南:list_skills(清单) / get_skill(key 取全文)——动笔前先读对应指南,",
  "指南的结构/口吻/字数/配图/码点预算要求优先于通用写法。",
  "落稿后核对:list_drafts(只列草稿,看「我的稿落库了吗」)。",
  "批量落稿(一周多篇不必逐篇往返):",
  '   curl -H "Authorization: Bearer <PAT>" -F "mds=@<a.md>" -F "mds=@<b.md>"',
  '        -F "files=@<图1.png>" <base>/api/posts/bundles/ —— 逐篇回报成败;',
  "   图片按**文件名**匹配引用,文件名宜带篇名前缀(如 a-cover.png)。",
  "信息卡:渲好后把卡片图路径列进 upsert_article 的 cardUrls(正文配图不入清单);",
  "声明了 cardUrls 就会校验「每张卡都已嵌入正文」,漏嵌直接拒稿。",
  "取增量信号:list_signals(since 或 nextCursor 续页,直到 nextCursor 为 null)——",
  "热点榜是簇级聚合,会漏掉两轮之间爆发又回落的话题,轮询取增量用信号流。",
  "贴图(小绿书)流程,图在本地生成后上传,不在线生图:",
  '1. 本地生成图 → curl -H "Authorization: Bearer <PAT>" -F "file=@<图.png>" <base>/api/media/',
  "   取 data.path(站内路径 /wp-content/uploads/…);",
  "2. create_pin(title, images:[path...]) —— 标题 ≤32 字,图片 1..20 张,首图即封面;",
  '3. set_pin_status(pinId, "pending") 提交验收(draft 态不许同步);',
  "4. sync_pin_to_wechat(pinId) → {jobId, token};",
  "5. get_distribute_job(jobId, token) 轮询到 completed。",
  "文章 → 公众号草稿:sync_article_to_wechat(postId) → get_distribute_job 轮询;",
  "推的是草稿箱不是发布,发布由站长在后台人工点;render_wechat_preview(postId) 可预览所见即所得。",
  "运营巡查面(M75,给运维助手 agent;周报在 agent 侧发,站内不管发消息):",
  "get_health_snapshot —— 采集健康度总览(牌价源/文章渠道/视频博主/队列与 AI 管线四域)+",
  "结构化问题清单 problems[](critical=源已挂或数据已脏,warning=降级或积压),每条带证据与建议;",
  "get_health_failures —— 一段时间内的失败明细与错误原文(写周报时列具体源与错因)。",
  "受限动作:trigger_recovery(手动重采:渠道/牌价源、视频博主、博主回补、GitHub 仓库;",
  "同一目标 5 分钟冷却,仅入队不阻塞);review_model_pricing(牌价上架/下架:ids 逐条给;",
  "上架须 confirm=true 且带 reason;带「待复核」标或源不健康的行会被闸门拒;下架为止损不做这两道闸)。",
  "offline_pricing_source —— 牌价源抓取失败时把该源**已上架**的数据下架(止损):",
  "按 sourceKey 定位源(取自 get_health_snapshot 的 pricing 段),圈定该源名下的行",
  "(口径同健康读侧:vendor + 产出面,模型表与套餐表都覆盖),把 enabled 的置 disabled;",
  "人工定稿行(is_pinned)与待终审行不动,已下架的跳过(幂等);须 confirm=true 且带 reason;",
  "源健康时会被拒(source_healthy)——只下架,不上架(重新上架走逐条 review_model_pricing)。",
  "该不该下架由你判断:本工具只负责执行,先看 get_health_snapshot 的源状态与连败次数",
  "(回执也带 lastCaptureError 与 rows 分布)。",
  "动作面刻意最小:不提供删除、停用源、重跑任务等不可逆操作。",
].join("\n");

export function createMcpServer(actor: AdminActor): McpServer {
  const server = new McpServer(
    { name: "aitech-hub", version: "0.2.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  // 只读面与创作面同一端点同一 PAT,读写工具集一
  registerTools(server, actor, allTools());

  return server;
}

/** 全量工具表(装配口径:只读面 → 文章面 → 贴图面 → 运维面) */
export function allTools(): McpToolDef[] {
  return [...feedTools, ...contentTools, ...pinTools, ...opsReadTools, ...opsActionTools];
}
