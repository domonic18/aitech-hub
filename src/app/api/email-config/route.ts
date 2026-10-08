/**
 * SMTP 邮件配置 API(M21 批⓪;用户拍板:配置入数据库 admin 后台维护,不入
 * env):GET 读脱敏视图(password 明文永不回传,只给 passwordSet);PUT 保存
 * (表单留空 password = 保留原值)。admin-only(requireAdminRequest——cookie
 * 会话 + role 判定,PAT 无从到场,严于 site-config 的 session 守卫:本端点
 * 管密钥)。mutation 走 Origin 校验(login 先例)。保存即时生效:mailer 的
 * transport 按 updatedAt 换新,无需重启/失效广播。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import { getSmtpConfigView, saveSmtpConfig, SmtpConfigUpdateSchema } from "@/lib/email/smtp-config";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");
  return apiEnvelope(0, "ok", await getSmtpConfigView());
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");

  const parsed = SmtpConfigUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, "配置不合法:主机/用户名/发件人必填,端口 1-65535,发件人须含邮箱地址");
  }
  if (parsed.data.password === undefined) {
    const view = await getSmtpConfigView();
    if (!view.passwordSet) return apiEnvelope(400, "首次配置必须填写 SMTP 密码");
  }

  const view = await saveSmtpConfig(parsed.data);
  logger.info({ event: "admin.email_config.saved", enabled: view.enabled }); // 密码/主机不入日志
  return apiEnvelope(0, "saved", view);
}
