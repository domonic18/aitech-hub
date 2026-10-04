/**
 * 站点配置 API(M10 批②):GET 读当前配置;PUT 保存(session 鉴权,PAT 拒绝,
 * 同 model-bindings 先例)。PUT 成功 on-demand revalidatePath("/", "layout")
 * 使首页 ISR 立即再生(带条数是首页预渲染取数)。
 */
import { type NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import {
  getBandItemCount,
  setBandItemCount,
  SiteConfigUpdateSchema,
} from "@/lib/config/site-config";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage site config";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  return apiEnvelope(0, "ok", { bandItemCount: await getBandItemCount() });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = SiteConfigUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "配置不合法(bandItemCount 须为 1-50 整数)");
  await setBandItemCount(parsed.data.bandItemCount);
  revalidatePath("/", "layout");
  return apiEnvelope(0, "saved", { bandItemCount: parsed.data.bandItemCount });
}
