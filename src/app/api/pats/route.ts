/**
 * PAT 管理 API(M5-c):仅会话通道——PAT 不得自我增殖(requirement §3.6)。
 * GET 列表;POST 创建 → data.token 为明文,仅此一次返回,服务端不落明文。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiEnvelope } from "@/lib/http/response";
import { requireSessionActor } from "@/lib/http/session-guard";
import { issuePat, listPats } from "@/lib/auth/pat";

export const dynamic = "force-dynamic";

const CreateBody = z.object({ name: z.string().trim().min(1).max(100) });

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, "PAT must not mint PATs");
  if (actor.kind === "reject") return actor.response;
  return apiEnvelope(0, "ok", { list: await listPats() });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, "PAT must not mint PATs");
  if (actor.kind === "reject") return actor.response;
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "name 必填且 ≤100 字");
  const issued = await issuePat(BigInt(actor.sub), parsed.data.name);
  return apiEnvelope(0, "created", issued);
}
