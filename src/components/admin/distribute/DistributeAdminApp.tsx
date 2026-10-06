"use client";

/**
 * 内容分发页客户端岛(M17 批①;原型缺,对齐 admin-models 页风格):
 * 公众号配置卡 + 同步记录表。变更后 router.refresh();批量/行操作批④⑤接。
 */
import type { WechatConfigView } from "@/lib/distribute/wechat-config-admin";
import type { PublishRecordRow } from "@/lib/distribute/records";

import SyncRecordsTable from "./SyncRecordsTable";
import WechatConfigCard from "./WechatConfigCard";

export default function DistributeAdminApp({
  config,
  records,
  total,
}: {
  config: WechatConfigView;
  records: PublishRecordRow[];
  total: number;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">内容分发</h2>
        <p className="mt-0.5 text-xs text-text-3">
          把站内文章同步到自媒体渠道草稿箱(一期:微信公众号,纯 API 推草稿不上线发表); AppSecret
          服务端加密存储,界面仅回显掩码(编辑留空表示不修改)。
        </p>
      </div>

      <WechatConfigCard config={config} />
      <SyncRecordsTable rows={records} total={total} />
    </div>
  );
}
