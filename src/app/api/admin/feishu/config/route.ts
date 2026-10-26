/**
 * 飞书免登配置 API(M29 批①,镜像 /api/email-config 惯例):GET 读脱敏视图
 * (appSecret 永不回传,只给 mask);PUT 保存(表单留空 secret = 保留原值;
 * 首次配置必须填 secret)。admin-only(requireAdminRequest),mutation 走
 * Origin 校验。enabled 可与凭证无关开关,但兑换侧以 enabled+凭证齐为准。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import {
  FeishuConfigUpdateSchema,
  getFeishuConfigAdmin,
  updateFeishuConfig,
} from "@/lib/auth/feishu-config";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");
  return apiEnvelope(0, "ok", await getFeishuConfigAdmin());
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");

  const parsed = FeishuConfigUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, "配置不合法:AppID 必填(≤50 字符),enabled 必填,密钥 ≤400 字符");
  }
  if (parsed.data.appSecret === undefined || parsed.data.appSecret === null) {
    const view = await getFeishuConfigAdmin();
    if (!view.appSecretMask) return apiEnvelope(400, "首次配置必须填写 AppSecret");
  }

  await updateFeishuConfig(parsed.data);
  return apiEnvelope(0, "saved", await getFeishuConfigAdmin());
}
