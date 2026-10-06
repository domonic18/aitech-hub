/**
 * 内容分发页(M17 批①,requirement §4 多渠道分发):公众号渠道配置 +
 * 同步记录。RSC 直读(records 免 API 路由),客户端岛负责交互。
 */
import DistributeAdminApp from "@/components/admin/distribute/DistributeAdminApp";
import { requireAdminPage } from "@/lib/auth/guard";
import { getWechatConfigAdmin } from "@/lib/distribute/wechat-config-admin";
import { listPublishChannelRecords } from "@/lib/distribute/records";
import { CHANNEL_WECHAT } from "@/lib/distribute/channels";

export const dynamic = "force-dynamic";

export default async function AdminDistributePage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const [config, records] = await Promise.all([
    getWechatConfigAdmin(),
    listPublishChannelRecords({ channel: CHANNEL_WECHAT }),
  ]);
  return <DistributeAdminApp config={config} records={records.rows} total={records.total} />;
}
