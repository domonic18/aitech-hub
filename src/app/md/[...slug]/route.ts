import { NextResponse } from "next/server";

import { htmlToMarkdown } from "@/lib/content/html-to-md";
import { buildLegacyPath, lookupLegacyPath } from "@/lib/content/legacy";
import { getPostById } from "@/lib/content/posts";
import { parsePostSegment, postPath } from "@/lib/content/post-path";
import { gateNoticeMd, previewMarkdown } from "@/lib/pay/preview";
import { absoluteUrl } from "@/lib/seo/site";

/**
 * 文章 Markdown 直出(GEO,requirement §3.2):GET /post/<id>-<slug>.md
 * (next.config rewrite 转发到本路由,与 /post/<id>-<slug>/ 同语义);
 * content_md 优先(新文),迁移旧文由清洗后 HTML 转换。ISR 1h。
 * 门禁文(付费/登录可见,2026-10-09 验收反馈问题2)只发同一份服务端截断
 * 预览 + 获取条件说明——与 ISR 页口径一致(无 cloaking),全文仍仅经
 * /api/pay/content 凭权益下发。旧单段 /<slug>.md(llms.txt 早期分发的形态)
 * 经映射表 301 到新形态 .md;弃用/未命中 404。
 */
export const revalidate = 3600;

function serveMarkdown(post: {
  contentMd: string | null;
  contentHtml: string | null;
  isPurchasable: boolean;
  isLoginRequired: boolean;
  id: bigint;
  slug: string | null;
}): NextResponse | null {
  const gate: "paid" | "login" | null = post.isPurchasable
    ? "paid"
    : post.isLoginRequired
      ? "login"
      : null;
  const source = post.contentMd ?? (post.contentHtml ? htmlToMarkdown(post.contentHtml) : "");
  if (!source.trim()) return null;
  const body = gate
    ? `${previewMarkdown(source)}\n\n${gateNoticeMd(gate, absoluteUrl(postPath(post.id, post.slug)))}\n`
    : source;
  return new NextResponse(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  }) as NextResponse;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string[] }> },
): Promise<NextResponse> {
  const { slug } = await params;
  // 新形态:/md/post/<id>-<slug>(rewrite 自 /post/<id>-<slug>.md,尾段 .md 由 rewrite 源剥除)
  if (slug.length === 2 && slug[0] === "post") {
    const parsed = parsePostSegment(slug[1]);
    const post = parsed ? await getPostById(parsed.id) : null;
    const body = post ? serveMarkdown(post) : null;
    return (body ?? new NextResponse("Not Found\n", { status: 404 })) as NextResponse;
  }
  // 旧单段:/md/<encoded-slug>(rewrite 自 /<slug>.md)→ 映射表命中 /post/** 才 301,其余 404
  if (slug.length === 1) {
    const raw = slug[0].replace(/\.md$/i, "");
    const lookup = await lookupLegacyPath(buildLegacyPath([raw]));
    if (lookup !== "miss" && lookup.targetUrl !== null && lookup.targetUrl.startsWith("/post/")) {
      const target = `${lookup.targetUrl.replace(/\/$/, "")}.md`;
      return NextResponse.redirect(absoluteUrl(target), 301) as NextResponse;
    }
  }
  return new NextResponse("Not Found\n", { status: 404 }) as NextResponse;
}
