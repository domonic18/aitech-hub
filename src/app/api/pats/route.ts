/**
 * PAT 管理 API(M5-c):仅会话通道——PAT 不得自我增殖(requirement §3.6)。
 * GET 列表;POST 创建 → data.token 为明文,仅此一次返回,服务端不落明文。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminRequest } from "@/lib/auth/guard";
import { issuePat, listPats } from "@/lib/auth/pat";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** 会话专用 mutation 守卫:Authorization 在场即拒(与 mutation-guard 双路相反) */
async function requireSessionActor(req: NextRequest): Promise<{ sub: string } | NextResponse> {
  if (req.headers.get("authorization") !== null) {
    return apiEnvelope(403, "PAT must not mint PATs");
  }
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const claims = await requireAdminRequest(req);
  if (!claims) {
    logger.warn({ event: "authz.denied", path: new URL(req.url).pathname });
    return apiEnvelope(401, "unauthorized");
  }
  return { sub: claims.sub };
}

const CreateBody = z.object({ name: z.string().trim().min(1).max(100) });

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req);
  if (actor instanceof NextResponse) return actor;
  return apiEnvelope(0, "ok", { list: await listPats() });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req);
  if (actor instanceof NextResponse) return actor;
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "name 必填且 ≤100 字");
  const issued = await issuePat(BigInt(actor.sub), parsed.data.name);
  return apiEnvelope(0, "created", issued);
}
