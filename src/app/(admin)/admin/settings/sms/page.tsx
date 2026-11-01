/**
 * 短信登录配置页(M65):阿里云号码认证服务「短信认证」通道凭证与开关入库维护
 * (不入 env——签名由阿里云签发且可能轮换)。保存即时生效;支持就地发测试短信
 * 验证 AccessKey / 签名 / 模板三者齐备。
 */
import SmsConfigForm from "@/components/admin/SmsConfigForm";
import { requireAdminPage } from "@/lib/auth/guard";
import { getSmsConfigView } from "@/lib/sms/config";

export const dynamic = "force-dynamic";

export default async function AdminSmsPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const config = await getSmsConfigView();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">短信登录</h2>
        <p className="mt-0.5 text-xs text-text-3">
          手机号验证码登录/注册通道(阿里云号码认证服务 PNVS 短信认证,个人实名可用); 凭据存
          user_sms_config,验证码由服务商托管,本站不落库。
        </p>
      </div>
      <SmsConfigForm initial={config} />
    </div>
  );
}
