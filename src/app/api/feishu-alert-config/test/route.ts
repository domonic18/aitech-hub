/**
 * 站务通知通道自检(M66):向目标群发一张测试卡片,验证 app_id / secret /
 * chat_id 三者可用(且应用已在群里)。结果写 channel_feishu_alert_config 的
 * last_test_* 三列。admin-only + Origin 校验;不校验 enabled——正是开启前探测。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import { sendAlertTestCard } from "@/lib/channel/feishu/alert";
import { recordFeishuAlertTest } from "@/lib/channel/feishu/config";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");

  const result = await sendAlertTestCard();
  await recordFeishuAlertTest(result).catch(() => undefined);

  if (!result.ok) {
    logger.error({ event: "admin.feishu_alert.test_failed", error: result.error });
    return apiEnvelope(502, result.error ?? "发送失败");
  }
  logger.info({ event: "admin.feishu_alert.test_ok", latencyMs: result.latencyMs });
  return apiEnvelope(0, "测试卡片已发送,请查看站务通知群", {
    latencyMs: result.latencyMs,
    messageId: result.messageId,
  });
}
