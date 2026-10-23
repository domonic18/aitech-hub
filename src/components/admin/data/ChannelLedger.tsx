/**
 * 数据中心·源管理·采集渠道段(F17 板):渠道 / 热榜 / 发现 / GitHub 统一台账。
 * RSC 装配五类行(buildChannelLedger)后交客户端表格渲染;「＋ 新增渠道」
 * 沿用 ChannelDialog(仅文字渠道;视频平台/热榜/GitHub 各有登记处)。
 */
import ChannelDialog from "@/components/admin/ChannelDialog";
import ChannelLedgerTable from "@/components/admin/data/ChannelLedgerTable";
import { buildChannelLedger } from "@/lib/collect/channel-ledger";

export default async function ChannelLedger(): Promise<React.ReactElement> {
  const rows = await buildChannelLedger();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">采集渠道配置</h2>
          <p className="mt-0.5 text-xs text-text-3">
            渠道 / 热榜 / 发现 / GitHub 统一台账 · 自动调度 + 手动触发 + 健康度同口径
          </p>
        </div>
        <ChannelDialog label="＋ 新增渠道" />
      </div>
      <ChannelLedgerTable rows={rows} />
    </div>
  );
}
