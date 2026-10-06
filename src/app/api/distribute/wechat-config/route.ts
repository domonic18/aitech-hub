/** 公众号渠道配置 API(M17 批①):单例视图与更新;appSecret 留空 = 保留旧钥。 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import {
  WechatConfigUpdateSchema,
  getWechatConfigAdmin,
  updateWechatConfig,
} from "@/lib/distribute/wechat-config-admin";
import { DISTRIBUTE_PAT_DENY } from "@/lib/distribute/channels";
import { DistributeError, distributeErrorStatus } from "@/lib/distribute/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, DISTRIBUTE_PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const config = await getWechatConfigAdmin();
  return apiEnvelope(0, "ok", { config });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, DISTRIBUTE_PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = WechatConfigUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "公众号配置字段不合法(AppID 必填)");
  try {
    await updateWechatConfig(parsed.data);
    return apiEnvelope(0, "updated", { config: await getWechatConfigAdmin() });
  } catch (e) {
    if (e instanceof DistributeError) {
      return apiEnvelope(distributeErrorStatus(e.code), e.message);
    }
    throw e;
  }
}
