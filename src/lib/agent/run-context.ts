/**
 * 会话 run 页面上下文(M27 批⑧-b,仿 ai-invest page_context 全链):前端
 * 发送瞬间从路由取上下文(page 纯函数 + edit 由编辑页 props 提供),随
 * stream body.context 上行,服务端把前缀注入本条 human 消息——模型可解析
 * 「这篇文章/当前专题」等指代。零依赖(仅 zod),客户端 bundle 可安全引入;
 * 图缓存键不含上下文(注入在消息层,身份档防线不在此)。
 */
import { z } from "zod";

import { parsePostSegment } from "@/lib/content/post-path";

/** edit 段 wire 契约(仅 admin 身份在服务端保留;客户端函数型 props 不过线) */
export const agentEditContextSchema = z.object({
  postId: z.string().regex(/^\d{1,20}$/),
  title: z.string().max(300),
});

/** 文章页上下文:客户端只传 postId(从 URL 解析);title/slug/gated 仅在服务端
 *  补全(parseAgentRunContext 会把入参里的这三个字段一律剥掉)——不存在信任面。 */
export const agentArticleContextSchema = z.object({
  postId: z.string().regex(/^\d{1,20}$/),
  title: z.string().max(300).optional(),
  slug: z.string().max(255).optional(),
  gated: z.boolean().optional(),
});

export const agentRunContextSchema = z.object({
  page: z.string().min(1).max(64),
  edit: agentEditContextSchema.optional(),
  article: agentArticleContextSchema.optional(),
});

export type AgentEditContext = z.infer<typeof agentEditContextSchema>;
export type AgentArticleContext = z.infer<typeof agentArticleContextSchema>;
export type AgentRunContext = z.infer<typeof agentRunContextSchema>;

/** 消息前缀标签(与 ai-invest page_context.yaml 模板同形) */
export const AGENT_CONTEXT_PREFIX = "[页面上下文]";

/**
 * 从路由构建 page 名(纯函数,调用方零订阅):编辑页 postId 不走 URL 推导
 * (由编辑页 props 单一真相源提供),此处只做页面语义标注;未命中回落粗粒度
 * 段名,保证上下文恒有 page 在场。
 */
export function buildAgentPageContext(pathname: string): string {
  const route = pathname.replace(/\/+$/, "") || "/";
  if (route === "/") return "首页";
  if (/^\/admin\/posts\/new$/.test(route)) return "文章新建";
  if (/^\/admin\/posts\/\d+$/.test(route)) return "文章编辑";
  if (/^\/admin\/posts/.test(route)) return "文章管理";
  if (/^\/admin\/studio/.test(route)) return "创作中心";
  if (/^\/admin/.test(route)) return "后台";
  if (/^\/search/.test(route)) return "搜索";
  if (/^\/telegram/.test(route)) return "电报流";
  if (/^\/projects/.test(route)) return "开源项目";
  // 文章详情(/post/<id>-<slug>):page 只标语义,id 由 buildAgentRunContext 解析
  if (/^\/post(?:\/|$)/.test(route)) return "文章详情";
  return "前台";
}

/**
 * 组合出口(AssistantCard 唯一调用):页面语义 + 文章 id。文章 id 走
 * post-path 的唯一解析函数,与详情页 canonical 归一同一口径;解析失败
 * (裸 /post、非数字段)只保留 page,不注入无效 article。
 */
export function buildAgentRunContext(pathname: string): AgentRunContext {
  const page = buildAgentPageContext(pathname);
  const route = pathname.replace(/\/+$/, "") || "/";
  const match = /^\/post\/([^/]+)$/.exec(route);
  const parsed = match === null ? null : parsePostSegment(match[1]);
  return parsed === null ? { page } : { page, article: { postId: parsed.id.toString() } };
}

/** 后台功能页上下文黑名单(M58 批⑤,arch/01 §3.4 复活规则):这些页的会话
 * 是「在用后台」而非「有需求」,即便普通用户提问也无信号价值;公开页
 * (首页/搜索/文章页/Footer 咨询/答案卡追问)一律放行,与身份无关。 */
export const ADMIN_SURFACES: ReadonlySet<string> = new Set([
  "后台",
  "文章新建",
  "文章编辑",
  "文章管理",
  "创作中心",
]);

export function isAdminSurface(page: string | null | undefined): boolean {
  return page !== null && page !== undefined && ADMIN_SURFACES.has(page);
}

/** 宽松解析(客户端传坏上下文不炸 run,弃用即可):形状不符返 null。
 *  article 只保留 postId:标题/门禁状态是服务端事实,由 enrichArticleContext
 *  查库补全,客户端伪造的同名字段在此剥除(zod 的 object 会保留已知键)。 */
export function parseAgentRunContext(value: unknown): AgentRunContext | null {
  const parsed = agentRunContextSchema.safeParse(value);
  if (!parsed.success) return null;
  const article = parsed.data.article;
  return article === undefined
    ? parsed.data
    : { ...parsed.data, article: { postId: article.postId } };
}

/**
 * 身份 sanitize(服务端,路由层调用):edit 段仅 admin 身份保留——游客/普通
 * 用户无编辑语义,剥除防误注入(fail-safe);page/article 名各身份无害保留。
 */
export function sanitizeAgentRunContext(
  context: AgentRunContext | null,
  identityKind: "admin" | "user" | "guest",
): AgentRunContext | null {
  if (context === null) return null;
  if (identityKind === "admin") return context;
  const { edit: _edit, ...rest } = context;
  return rest;
}

/** 前缀注入(ai-invest _with_page_context 同款):无上下文原样返回 */
export function withAgentContext(message: string, context: AgentRunContext | null): string {
  if (context === null) return message;
  return `${AGENT_CONTEXT_PREFIX} ${JSON.stringify(context)}\n\n${message}`;
}
