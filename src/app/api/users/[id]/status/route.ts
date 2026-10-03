/**
 * 用户状态变更(M5-c):仅会话通道;路由层守卫「不能变更自己」(防自锁),
 * service 层负责禁用连带吊销全部 PAT。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { UserAdminError, setUserStatus } from "@/lib/users/admin-users";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage users";
const Body = z.object({ status: z.enum(["active", "disabled"]) });

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!/^\d{1,19}$/.test(id)) return apiEnvelope(400, "invalid id");
  if (BigInt(id) === BigInt(actor.sub)) return apiEnvelope(400, "不能变更当前登录账号的状态");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "status 须为 active|disabled");
  try {
    const r = await setUserStatus(BigInt(id), parsed.data.status);
    return apiEnvelope(0, r.status === "active" ? "enabled" : "disabled", r);
  } catch (e) {
    if (e instanceof UserAdminError) return apiEnvelope(404, e.message);
    throw e;
  }
}
