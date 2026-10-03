import { notFound } from "next/navigation";

import { legacyRedirectOrNotFound } from "@/lib/content/legacy";

/**
 * 旧单段 URL 承接(2026-10 URL 迁移后不再直接服务文章:详情已迁至 /post/<id>-<slug>/):
 * 查 legacy_url_map(103 篇旧链 301 → 新形态;53 篇下架删除 410)→ 命中 permanentRedirect(308),
 * 弃用/未命中 notFound。动态按需渲染,查表经 Redis 1h 缓存;精确 301 由 /legacy/[...path] 路由表达。
 */
export const revalidate = 600;

export default async function LegacySlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  await legacyRedirectOrNotFound([slug]); // 必抛:命中 → permanentRedirect;弃用/未命中 → notFound
  notFound();
}
