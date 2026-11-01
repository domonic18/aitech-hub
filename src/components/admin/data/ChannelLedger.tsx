/**
 * 数据中心·源管理·采集渠道段(F17 板):资讯 RSS / 厂商动态 / 榜单 / 社区语料 /
 * 牌价 / 视频平台 / 热榜源 / 发现/GitHub 按分组分节展示(2026-10-30 对齐
 * 采集计划板口径)。RSC 装配各行(buildChannelLedger)后交客户端表格渲染;
 * 「＋ 新增渠道」沿用 ChannelDialog(仅文字渠道;视频平台/热榜/GitHub 各有登记处)。
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
            按分组分节(渠道类型 / 牌价 / 视频 / 热榜 / 发现 / GitHub)· 自动调度 + 手动触发 +
            健康度同口径 · 备注列解释内部渠道键
          </p>
        </div>
        <ChannelDialog label="＋ 新增渠道" />
      </div>
      <ChannelLedgerTable rows={rows} />
    </div>
  );
}
