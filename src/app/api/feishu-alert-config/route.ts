/**
 * 站务通知(飞书自建应用)配置 API(M66)。
 *
 * 用户裁定:app_id / app_secret 只入库,**不进代码、不进 env**。GET 返回脱敏
 * 视图(secret 只回 Set + 掩码);PUT 整行覆盖(secret 留空 = 保留原值)。
 * admin-only(cookie 会话)+ Origin 校验(与 sms-config 同款)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import {
  FeishuAlertConfigUpdateSchema,
  getFeishuAlertConfigView,
  saveFeishuAlertConfig,
} from "@/lib/channel/feishu/config";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");
  return apiEnvelope(0, "ok", await getFeishuAlertConfigView());
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");

  const parsed = FeishuAlertConfigUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "配置不合法:汇总时刻 0-23,字段长度超限");

  if (parsed.data.enabled) {
    const current = await getFeishuAlertConfigView();
    const secretReady = Boolean(parsed.data.appSecret?.trim()) || current.appSecretSet;
    if (!parsed.data.appId || !parsed.data.chatId || !secretReady) {
      return apiEnvelope(400, "启用前请填全 App ID、App Secret 与群 chat_id");
    }
  }

  const view = await saveFeishuAlertConfig(parsed.data);
  // 凭据不入日志
  logger.info({ event: "admin.feishu_alert_config.saved", enabled: view.enabled });
  return apiEnvelope(0, "saved", view);
}
