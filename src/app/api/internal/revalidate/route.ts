import { createHash, timingSafeEqual } from "node:crypto";

import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";

/**
 * 内部缓存失效(镜像构建期降级产物预热用,docker/app/entrypoint.sh 调用;
 * M5 管理侧如需全量刷新亦复用)。鉴权:AUTH_SECRET 派生对称 token,
 * 不新增配置面;仅 POST,幂等。
 *
 * 2026-10-31 扩展:`body.paths` 可选。不带 body = 全站失效(entrypoint 老口径,
 * 行为不变);带 paths = 只失效白名单内的路径。生产者是 worker(榜单采集成功后
 * 反向调用)——worker 没有 Next 请求上下文,自己调不了 revalidatePath,而每次
 * 全站失效会把文章列表等全部打回重生成,故收敛成定向失效。
 * 白名单是红线:内部端点绝不能变成任意路径的缓存清除器。
 */
export const dynamic = "force-dynamic";

const SEO_ROUTES = ["/sitemap.xml", "/feed.xml", "/llms.txt", "/llms-full.txt", "/robots.txt"];

/** 定向失效允许的路径(新增时同步加这里,勿用动态拼接) */
const PATH_ALLOWLIST = new Set<string>(["/leaderboards/"]);

const bodySchema = z.object({ paths: z.array(z.string().min(1).max(200)).min(1).max(10) });

function expectedToken(): string {
  return createHash("sha256").update(`${env.AUTH_SECRET}:revalidate`).digest("hex");
}

/** 空 body(entrypoint 老调用)/非法 JSON 一律按「全站失效」处理,保持向后兼容 */
async function readPaths(req: NextRequest): Promise<string[] | null> {
  const text = await req.text();
  if (text.trim() === "") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = bodySchema.safeParse(raw);
  return parsed.success ? parsed.data.paths : null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const given = Buffer.from(req.headers.get("x-internal-token") ?? "");
  const expected = Buffer.from(expectedToken());
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return new NextResponse(null, { status: 403 }) as NextResponse;
  }
  const paths = await readPaths(req);
  if (paths !== null) {
    const blocked = paths.filter((p) => !PATH_ALLOWLIST.has(p));
    if (blocked.length > 0) return apiEnvelopeError(blocked);
    for (const path of paths) revalidatePath(path);
    return NextResponse.json({ revalidated: true, paths }) as NextResponse;
  }
  revalidatePath("/", "layout"); // (site) 树全部页面
  for (const path of SEO_ROUTES) revalidatePath(path);
  return NextResponse.json({ revalidated: true }) as NextResponse;
}

function apiEnvelopeError(blocked: string[]): NextResponse {
  return NextResponse.json(
    { code: 400, message: `path not in allowlist: ${blocked.join(",")}` },
    { status: 400 },
  ) as NextResponse;
}
