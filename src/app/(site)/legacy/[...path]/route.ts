import { NextResponse, type NextRequest } from "next/server";

import { buildLegacyPath, lookupLegacyPath } from "@/lib/content/legacy";
import { absoluteUrl } from "@/lib/seo/site";

/**
 * 旧 URL 兜底路由(arch/07-frontend §6):Nginx 把新站未命中路径转发到 /legacy/<path>。
 * 命中 → 按表内 http_status 重定向;target_url 为 NULL → 410;未命中 → 404。
 * 单段 slug 的本地兜底由 /[slug] 页面同表完成(见 lib/content/legacy.ts)。
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await params;
  const lookup = await lookupLegacyPath(buildLegacyPath(path));

  if (lookup !== "miss" && lookup.targetUrl !== null) {
    return NextResponse.redirect(
      absoluteUrl(lookup.targetUrl),
      lookup.httpStatus === 302 ? 302 : 301,
    );
  }
  if (lookup !== "miss") {
    // 弃用内容:410 Gone(弃用内容承接:资讯类 301 列表页,其余 410)
    return new NextResponse(null, { status: 410 }) as NextResponse;
  }
  return new NextResponse("Not Found", { status: 404 }) as NextResponse;
}
