/**
 * 数据中心·运行·实时页(F20 板):采集引擎卡(活跃 job/即将运行/最近运行)+
 * 监视格 2×2(文字渠道/视频博主/批次任务/队列)+ 按博主排队 + 依赖条
 * (pg/redis/card-renderer/gateway 探针)。板外观测能力(队列四泳道/入库
 * 观测/信号强度/最近错误)折叠保留在 run/OverviewFolds。纯只读 RSC。
 */
import LiveRefresher from "@/components/admin/data/LiveRefresher";
import BloggerQueueCard from "@/components/admin/data/run/BloggerQueueCard";
import DepsBar from "@/components/admin/data/run/DepsBar";
import EngineCard from "@/components/admin/data/run/EngineCard";
import MonitorGrid from "@/components/admin/data/run/MonitorGrid";
import {
  ErrorsFold,
  IngestFold,
  QueueFold,
  SignalFold,
} from "@/components/admin/data/run/OverviewFolds";
import { crawlerActiveRuns } from "@/lib/collect/channel-ledger";

export default async function RunOverview(): Promise<React.ReactElement> {
  const active = await crawlerActiveRuns();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-text-3">
          采集引擎与队列实况;源的启停与手动触发回「源管理」,排程看「计划」,成败明细看「采集日志」。
        </p>
        <span className="ml-auto">
          <LiveRefresher running={active.length} />
        </span>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(320px,2fr)_3fr]">
        <EngineCard />
        <MonitorGrid />
      </div>

      <BloggerQueueCard />
      <DepsBar />

      <div className="flex flex-col gap-3 border-t border-line pt-3">
        <QueueFold />
        <IngestFold />
        <SignalFold />
        <ErrorsFold />
      </div>
    </div>
  );
}
