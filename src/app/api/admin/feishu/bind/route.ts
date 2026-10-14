/**
 * admin 账号 ↔ 飞书身份绑定 API(M29 批①):POST {code} = 密码会话内自绑/
 * 换绑(授权码由飞书工作台 h5sdk 兑换;此处再向飞书换身份落白名单);
 * DELETE = 自解绑(无绑定按幂等成功)。绑定只要求凭证齐(enabled 可后开,
 * 绑定是启用前置)。跨锚冲突(unionId 被他人占用)409。现网单管理员,
 * plan「超管解绑」由自解绑覆盖。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { bindFeishu, getBindingForUser, unbindFeishu } from "@/lib/auth/feishu-binding";
import { getFeishuRuntimeConfig } from "@/lib/auth/feishu-config";
import { exchangeFeishuIdentity } from "@/lib/auth/feishu-client";
import { feishuErrorStatus, FeishuError } from "@/lib/auth/feishu-errors";
import { requireAdminRequest } from "@/lib/auth/guard";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ code: z.string().trim().min(1, "授权码不能为空").max(200) });

export async function GET(req: NextRequest): Promise<NextResponse> {
  const claims = await requireAdminRequest(req);
  if (!claims) return apiEnvelope(401, "unauthorized");
  return apiEnvelope(0, "ok", await getBindingForUser(BigInt(claims.sub)));
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const claims = await requireAdminRequest(req);
  if (!claims) return apiEnvelope(401, "unauthorized");

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "invalid body: 授权码不能为空");

  const cfg = await getFeishuRuntimeConfig();
  if (!cfg?.appId || !cfg.appSecret) {
    return apiEnvelope(400, "请先保存飞书应用凭证(AppID/AppSecret)再绑定");
  }
  const creds = { appId: cfg.appId, appSecret: cfg.appSecret };
  try {
    const identity = await exchangeFeishuIdentity(creds, parsed.data.code);
    const binding = await bindFeishu(BigInt(claims.sub), identity);
    return apiEnvelope(0, "已绑定", binding);
  } catch (e) {
    if (e instanceof FeishuError) {
      return apiEnvelope(feishuErrorStatus(e.code), e.message);
    }
    throw e;
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const claims = await requireAdminRequest(req);
  if (!claims) return apiEnvelope(401, "unauthorized");
  await unbindFeishu(BigInt(claims.sub));
  return apiEnvelope(0, "已解绑", null);
}
