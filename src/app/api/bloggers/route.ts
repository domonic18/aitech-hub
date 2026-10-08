/**
 * 博主台账 API(M8 批③):列表与登记。博主管控 Cookie 池消费与采集调度,
 * 仅会话通道(PAT 不得管理基础设施配置,同 channels 口径)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import {
  BloggerAdminError,
  BloggerCreateSchema,
  createBlogger,
  listBloggersAdmin,
} from "@/lib/telegram/bloggers-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage bloggers";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const items = await listBloggersAdmin();
  return apiEnvelope(0, "ok", { items });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = BloggerCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "登记字段不合法(主页链接或 sec_uid)");
  try {
    const r = await createBlogger(parsed.data);
    return apiEnvelope(0, "created", r);
  } catch (e) {
    if (e instanceof BloggerAdminError) {
      return apiEnvelope(
        e.code === "duplicate" ? 409 : e.code === "not_found" ? 404 : 400,
        e.message,
      );
    }
    throw e;
  }
}
