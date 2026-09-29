import { NextResponse } from "next/server";

import { htmlToMarkdown } from "@/lib/content/html-to-md";
import { getPostBySlug } from "@/lib/content/posts";

/**
 * 文章 Markdown 直出(GEO,requirement §3.2):GET /<slug>.md
 * (next.config rewrite 转发到本路由,与 /<slug>/ 同语义);
 * content_md 优先(新文),迁移旧文由清洗后 HTML 转换。ISR 1h。
 */
export const revalidate = 3600;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string[] }> },
): Promise<NextResponse> {
  const { slug } = await params;
  // slug 仅支持单段(与 /<slug>/ 路由形态一致);数组尾部 .md 由 rewrite 源剥除
  if (slug.length !== 1) {
    return new NextResponse("Not Found\n", { status: 404 }) as NextResponse;
  }
  const raw = slug[0].replace(/\.md$/i, "");
  const post = await getPostBySlug(raw);
  if (!post) {
    return new NextResponse("Not Found\n", { status: 404 }) as NextResponse;
  }
  const body = post.contentMd ?? (post.contentHtml ? htmlToMarkdown(post.contentHtml) : "");
  if (!body.trim()) {
    return new NextResponse("Not Found\n", { status: 404 }) as NextResponse;
  }
  return new NextResponse(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  }) as NextResponse;
}
