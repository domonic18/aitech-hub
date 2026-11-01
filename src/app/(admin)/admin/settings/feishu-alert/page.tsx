/**
 * 站务通知(飞书自建应用)设置页(M66):app_id / app_secret / 群 chat_id
 * 全部走数据库配置(channel_feishu_alert_config),不进代码、不进 env。
 * 用于公众号转人工线索的即时提醒与每日汇总;发送测试卡片验证三者可用。
 */
import FeishuAlertConfigForm from "@/components/admin/wechat-mp/FeishuAlertConfigForm";
import { requireAdminPage } from "@/lib/auth/guard";
import { getFeishuAlertConfigView } from "@/lib/channel/feishu/config";

export const dynamic = "force-dynamic";

export default async function AdminFeishuAlertSettingsPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const view = await getFeishuAlertConfigView();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">站务通知</h2>
        <p className="mt-0.5 text-xs text-text-3">
          飞书自建应用 → 目标群机器人消息;凭据只入库(加密存储、脱敏回显)。应用需已加入目标群, 否则报
          230002/权限类错误。
        </p>
      </div>

      <FeishuAlertConfigForm initial={view} />
    </div>
  );
}
