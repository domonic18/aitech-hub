/**
 * 数据中心·计划页内容(F21/F22,IA v5 板定):六业务分组计划板(资讯RSS/
 * 热榜/社媒/发现/分析/维护)+ 日/周/月日历 + 常驻 tick 清单。行与日历条目由
 * buildPlanRows 聚合(渠道采集间隔与登记表 cron 派生,下次执行实时计算);
 * 手动触发统一在 源管理·台账(板 hint)。渠道间隔排程细节已被 F21 资讯RSS
 * 分组覆盖,原 ChannelIntervalLedger 只读表退役。
 */
import PlanBoard from "@/components/admin/data/PlanBoard";
import { buildPlanRows } from "@/lib/collect/plan-rows";

export default async function RunPlan(): Promise<React.ReactElement> {
  const { rows, calEntries } = await buildPlanRows();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">采集计划</h2>
        <p className="mt-0.5 text-xs text-text-3">
          调度由渠道采集间隔与发现 / 分析 cron 派生 · 下次执行实时计算 · 手动触发统一在 源管理 ·
          台账
        </p>
      </div>
      <PlanBoard rows={rows} calEntries={calEntries} />
    </div>
  );
}
