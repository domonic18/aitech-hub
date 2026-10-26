/**
 * POST /api/distribute/xiaohongshu/cookies(M49 批X3):小红书登录态录入。
 * 抖音 Cookie 池同款心智:F12 复制完整 Cookie 请求头粘贴 → web 转发
 * xhs-gateway 验证登录 → storage_state 卷落盘(全局生效,所有贴图免登)。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { ingestXhsCookies } from "@/lib/pins/xhs";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage pins";
const cookiesInputSchema = z.object({
  cookieHeader: z.string().min(10).max(8000),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const body = cookiesInputSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return apiEnvelope(400, "参数无效(cookie 串过短?)");
  }
  try {
    await ingestXhsCookies(body.data.cookieHeader);
    return apiEnvelope(0, "ok", { logged_in: true });
  } catch (e) {
    return apiEnvelope(500, e instanceof Error ? e.message : "登录态录入失败");
  }
}
