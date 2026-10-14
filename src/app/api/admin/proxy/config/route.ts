/**
 * 系统出口代理配置 API(M33 批B,镜像 /api/admin/feishu/config):GET 读脱敏
 * 视图(proxyUrl 永不回传,只给 scheme://host:port 形 mask);PUT 保存(表单
 * 留空 = 保留原址;首次配置必须填 URL)。admin-only(requireAdminRequest),
 * mutation 走 Origin 校验。enabled 独立开关,运行时以 enabled+URL 在位为准。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import {
  EgressProxyUpdateSchema,
  getEgressProxyConfigAdmin,
  updateEgressProxyConfig,
} from "@/lib/telegram/egress-proxy";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");
  return apiEnvelope(0, "ok", await getEgressProxyConfigAdmin());
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");

  const parsed = EgressProxyUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, "配置不合法:代理 URL 须为 http(s):// 或 socks4/5:// 形态(≤500 字符)");
  }
  if (parsed.data.proxyUrl === undefined || parsed.data.proxyUrl === null) {
    const view = await getEgressProxyConfigAdmin();
    if (!view.proxyUrlMask) return apiEnvelope(400, "首次配置必须填写代理 URL");
  }

  await updateEgressProxyConfig(parsed.data);
  return apiEnvelope(0, "saved", await getEgressProxyConfigAdmin());
}
