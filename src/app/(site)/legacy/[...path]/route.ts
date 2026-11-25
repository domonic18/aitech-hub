import { NextResponse, type NextRequest } from "next/server";

import {
  buildLegacyPath,
  decideWpPost,
  lookupLegacyPath,
  lookupWpPost,
} from "@/lib/content/legacy";
import { postPath } from "@/lib/content/post-path";
import { isBigIntId } from "@/lib/http/parse-id";
import { absoluteUrl } from "@/lib/seo/site";

/**
 * 旧 URL 兜底路由(arch/07-frontend §6):Nginx 把新站未命中路径转发到 /legacy/<path>。
 * 命中 → 按表内 http_status 重定向;target_url 为 NULL → 410;未命中 → 404。
 * 单段 slug 的本地兜底由 /[slug] 页面同表完成(见 lib/content/legacy.ts)。
 * wp-p/<id>:旧 WP query 形态 /?p=<id> 的承接(middleware rewrite 进来,
 * 见 middleware.ts);已发布 → 301 文章页,草稿/弃用 → 410。
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await params;

  if (path[0] === "wp-p") {
    if (path.length !== 2 || !isBigIntId(path[1])) {
      return new NextResponse(null, { status: 404 });
    }
    const lookup = await lookupWpPost(BigInt(path[1]));
    if (decideWpPost(lookup) !== "redirect") {
      return new NextResponse(null, { status: 410 });
    }
    const hit = lookup as { id: string; slug: string | null; status: string };
    return NextResponse.redirect(absoluteUrl(postPath(BigInt(hit.id), hit.slug)), 301);
  }

  const lookup = await lookupLegacyPath(buildLegacyPath(path));

  if (lookup !== "miss" && lookup.targetUrl !== null) {
    return NextResponse.redirect(
      absoluteUrl(lookup.targetUrl),
      lookup.httpStatus === 302 ? 302 : 301,
    );
  }
  if (lookup !== "miss") {
    // 弃用内容:410 Gone(弃用内容承接:资讯类 301 列表页,其余 410)
    return new NextResponse(null, { status: 410 });
  }
  return new NextResponse("Not Found", { status: 404 });
}
