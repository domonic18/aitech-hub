/**
 * 公众号入站配置 API(M66):GET 脱敏视图 / PUT 整行覆盖。
 *
 * 与 sms-config 同款纪律:admin-only(cookie 会话)、mutation Origin 校验、
 * EncodingAESKey write-only(留空 = 保留原值,读侧只回 Set + 掩码)。
 * 公众号 appid/appsecret 不在此表——单源是 `publish_wechat_config`(M17 分发共用)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import {
  WechatMpConfigUpdateSchema,
  getWechatMpConfigView,
  saveWechatMpConfig,
} from "@/lib/channel/wechat-mp/config";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");
  return apiEnvelope(0, "ok", await getWechatMpConfigView());
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");

  const parsed = WechatMpConfigUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, "配置不合法:话术 ≤500 字、转人工词 ≤20 个、日上限 1-10000");
  }

  // 启用门:保存前判定「保存后」是否齐备,避免先落一个 enabled 却跑不起来的行
  if (parsed.data.enabled) {
    const current = await getWechatMpConfigView();
    const aesKeyReady = Boolean(parsed.data.encodingAESKey?.trim()) || current.encodingAesKeySet;
    if (!parsed.data.token.trim() || !aesKeyReady) {
      return apiEnvelope(400, "启用前请填全 Token 与 EncodingAESKey");
    }
    if (!current.appId) {
      return apiEnvelope(400, "启用前请先在「公众号分发」配置 AppID(公众号私信与发文共用同一枚)");
    }
  }

  let view;
  try {
    view = await saveWechatMpConfig(parsed.data);
  } catch (e) {
    return apiEnvelope(400, e instanceof Error ? e.message : "保存失败");
  }

  // Token/密钥不入日志
  logger.info({ event: "admin.wechat_mp_config.saved", enabled: view.enabled });
  return apiEnvelope(0, "saved", view);
}
