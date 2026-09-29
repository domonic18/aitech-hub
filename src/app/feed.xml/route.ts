import { NextResponse } from "next/server";

import { RSS_FEED_SIZE } from "@/lib/constants";
import { listAllPostsForSeo } from "@/lib/content/posts";
import { excerptOf } from "@/lib/content/format";
import { absoluteUrl, siteUrl } from "@/lib/seo/site";

/** RSS 2.0(04 文档 §3:最新 20 篇;旧 /feed/ 由 Nginx 301 接入) */
export const revalidate = 3600;

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function GET(): Promise<NextResponse> {
  const posts = (await listAllPostsForSeo()).slice(0, RSS_FEED_SIZE);
  const items = posts
    .map((p) => {
      const link = absoluteUrl(`/${p.slug}/`);
      return [
        "    <item>",
        `      <title>${escapeXml(p.title)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
        p.publishedAt ? `      <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>` : null,
        `      <description>${escapeXml(excerptOf(p))}</description>`,
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>一起AI技术</title>
    <link>${escapeXml(siteUrl())}</link>
    <description>domonic18 的 AI 工程实战原创博客</description>
    <language>zh-CN</language>
${items}
  </channel>
</rss>
`;

  return new NextResponse(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  }) as NextResponse;
}
