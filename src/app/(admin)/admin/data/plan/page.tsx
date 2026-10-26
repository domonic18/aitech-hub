/**
 * 数据中心·计划页(IA v5 板定:计划自 run 子段升独立页签,F21 列表/F22 日历
 * 两视图在 PlanBoard 内 Segmented 切换)。调度由渠道采集间隔与发现/分析
 * cron 派生;手动触发统一在 源管理·台账。
 */
import RunPlan from "@/components/admin/data/RunPlan";
import { requireAdminPage } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function AdminDataPlanPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  return <RunPlan />;
}
