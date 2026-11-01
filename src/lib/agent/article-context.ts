/**
 * 文章页上下文服务端补全(M69):客户端只从 URL 解析出 postId,标题/门禁标记
 * 一律以库内已发布行为准——伪造 id 或已下架文直接丢弃 article 段,不向模型
 * 注入不存在的文章。查库为单条主键命中(PUBLISHED),只在新提问时发生一次。
 */
import { PUBLISHED } from "../content/posts";
import { prisma } from "../db";
import { parseBigIntId } from "../http/parse-id";

import type { AgentRunContext } from "./run-context";

export async function enrichArticleContext(
  context: AgentRunContext | null,
): Promise<AgentRunContext | null> {
  if (context === null || context.article === undefined) return context;
  const page = context.page;
  const id = parseBigIntId(context.article.postId);
  if (id === null) return { page };
  const post = await prisma.post.findFirst({
    where: { id, ...PUBLISHED },
    select: { slug: true, title: true, isPurchasable: true, isLoginRequired: true },
  });
  if (post === null) return { page };
  return {
    ...context,
    article: {
      postId: context.article.postId,
      title: post.title.slice(0, 300),
      ...(post.slug === null ? {} : { slug: post.slug }),
      gated: post.isPurchasable || post.isLoginRequired,
    },
  };
}
