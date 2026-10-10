/**
 * 邮件配置页(M21 批⓪,侧栏「系统」组):SMTP 入库维护(admin 表单,不入
 * env——用户拍板 2026-10-08,与支付网关配置同规则)。注册验证邮件经
 * email_config 发出;未配置/未启用时发送显式跳过(注册主流程不受阻)。
 * password 只写不读:表单留空 = 保留原值,保存即时生效。
 */
import EmailConfigForm from "@/components/admin/EmailConfigForm";
import { requireAdminPage } from "@/lib/auth/guard";
import { getSmtpConfigView } from "@/lib/email/smtp-config";

export const dynamic = "force-dynamic";

export default async function AdminEmailPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const initial = await getSmtpConfigView();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">邮件配置</h2>
        <p className="mt-0.5 text-xs text-text-3">
          事务邮件 SMTP(注册验证等);配置存 email_config
          表,保存即时生效,支持就地发送测试邮件验证连通。
        </p>
      </div>
      <EmailConfigForm initial={initial} />
    </div>
  );
}
