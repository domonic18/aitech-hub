import { createHash, timingSafeEqual } from "node:crypto";

import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";

/**
 * 内部全量失效(镜像构建期降级产物预热用,docker/entrypoint.sh 调用;
 * M5 管理侧如需全量刷新亦复用)。鉴权:AUTH_SECRET 派生对称 token,
 * 不新增配置面;仅 POST,幂等。
 */
export const dynamic = "force-dynamic";

const SEO_ROUTES = ["/sitemap.xml", "/feed.xml", "/llms.txt", "/llms-full.txt", "/robots.txt"];

function expectedToken(): string {
  return createHash("sha256").update(`${env.AUTH_SECRET}:revalidate`).digest("hex");
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const given = Buffer.from(req.headers.get("x-internal-token") ?? "");
  const expected = Buffer.from(expectedToken());
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return new NextResponse(null, { status: 403 }) as NextResponse;
  }
  revalidatePath("/", "layout"); // (site) 树全部页面
  for (const path of SEO_ROUTES) revalidatePath(path);
  return NextResponse.json({ revalidated: true }) as NextResponse;
}
