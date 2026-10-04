/**
 * Cookie 池 API(M8 批③):GET 池状态(脱敏)/ POST 导入单份 jar / DELETE 清空。
 * 静态段优先于 [id] 解析(先例 api/telegram/public);cookie 值只写不读,日志禁打。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { BloggerAdminError } from "@/lib/telegram/bloggers-admin";
import {
  clearCookieJars,
  CookieImportSchema,
  getCookiePoolView,
  importCookieJar,
} from "@/lib/telegram/social-platform-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage bloggers";

function mapError(e: BloggerAdminError): NextResponse {
  return apiEnvelope(e.code === "not_found" ? 404 : 400, e.message);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  return apiEnvelope(0, "ok", await getCookiePoolView());
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = CookieImportSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "导入字段不合法(平台 + 完整 Cookie 串)");
  try {
    const r = await importCookieJar(parsed.data.platform, parsed.data.cookie);
    return apiEnvelope(0, "imported", r);
  } catch (e) {
    if (e instanceof BloggerAdminError) return mapError(e);
    throw e;
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const platform = req.nextUrl.searchParams.get("platform") ?? "";
  if (!(platform === "douyin" || platform === "xhs" || platform === "bilibili")) {
    return apiEnvelope(400, "platform 不合法");
  }
  try {
    await clearCookieJars(platform);
    return apiEnvelope(0, "cleared");
  } catch (e) {
    if (e instanceof BloggerAdminError) return mapError(e);
    throw e;
  }
}
