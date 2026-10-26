/**
 * POST /api/pins/[id]/xhs/cookies(M49 批X3):小红书登录态录入(抖音同款
 * 手动 Cookie 心智)。body {cookieHeader};web 容器转发 xhs-gateway 验证
 * 登录并落 storage_state 卷。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { parseBigIntId } from "@/lib/http/parse-id";
import { ingestXhsCookies } from "@/lib/pins/xhs";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage pins";
const cookiesInputSchema = z.object({
  cookieHeader: z.string().min(10).max(8000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const pinId = parseBigIntId(id);
  if (pinId === null) {
    return apiEnvelope(400, "贴图 id 不合法");
  }
  const body = cookiesInputSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return apiEnvelope(400, "参数无效(cookie 串过短?)");
  }
  try {
    await ingestXhsCookies(pinId, body.data.cookieHeader);
    return apiEnvelope(0, "ok", { logged_in: true });
  } catch (e) {
    return apiEnvelope(500, e instanceof Error ? e.message : "登录态录入失败");
  }
}
