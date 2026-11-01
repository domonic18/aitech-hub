"use client";

/**
 * 分发中心客户端岛(M17 批①建;F16 板对齐):pageHead + KPI 三卡 +
 * 渠道四卡(微信公众号实卡 + 三张即将接入占位)+ 最近同步记录。
 * 变更后 router.refresh();筛选/分页由 RSC 页面以 children 注入
 * (SyncRecordsTable 同 PostsTable 模式,批⑤)。
 */
import type { WechatConfigView } from "@/lib/distribute/wechat-config-admin";
import type { DistributeOverview, PublishRecordRow } from "@/lib/distribute/records";
import type { XhsProbeRecord } from "@/lib/distribute/xhs-probe";

import XhsChannelCard from "./XhsChannelCard";

import StatsRow from "./StatsRow";
import SyncRecordsTable from "./SyncRecordsTable";
import WechatConfigCard from "./WechatConfigCard";

/** F16 板右侧三张占位卡:tag「即将接入」/ 规划说明,无交互 */
function ChannelPlaceholder({
  name,
  tag,
  desc,
  note,
}: {
  name: string;
  tag?: string;
  desc?: string;
  note?: string;
}) {
  return (
    <div className="rounded-md border border-line bg-panel px-4 py-4">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-text-1">{name}</span>
        {tag && (
          <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 text-[10px] text-text-3">{tag}</span>
        )}
      </div>
      {desc && <div className="mt-2 text-[11.5px] text-text-2">{desc}</div>}
      {note && <div className="mt-2 text-[11px] text-text-3">{note}</div>}
    </div>
  );
}

export default function DistributeAdminApp({
  config,
  overview,
  records,
  total,
  lastProbe,
  filter,
  children,
}: {
  config: WechatConfigView;
  overview: DistributeOverview;
  records: PublishRecordRow[];
  total: number;
  /** 小红书登录态每日探照快照(M50 批F;null=未探测) */
  lastProbe?: XhsProbeRecord | null;
  /** 记录状态筛选条(RSC 渲染的 Link 组,注入表头;hrefFor 函数不能跨界) */
  filter?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">分发中心</h2>
        <p className="mt-0.5 text-xs text-text-3">
          可在文章列表 / 编辑器 / 贴图台直接发起同步(一期:微信公众号,纯 API 推草稿不上线发表)。
        </p>
      </div>

      <StatsRow overview={overview} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <WechatConfigCard config={config} overview={overview} />
        <XhsChannelCard lastProbe={lastProbe} />
        <ChannelPlaceholder name="掘金" tag="即将接入" desc="技术文章发布" />
        <ChannelPlaceholder name="更多渠道" desc="CSDN · 知乎" note="接入形态规划中" />
      </div>

      <SyncRecordsTable rows={records} total={total} filter={filter}>
        {children}
      </SyncRecordsTable>
    </div>
  );
}
