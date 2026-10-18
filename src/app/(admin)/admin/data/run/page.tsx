/**
 * 数据中心·运行页(调度+呈现段):采集总览(强度/队列/日历/错误)+ 任务日志
 * (job_run 台账明细,验收二批③)+ 健康聚合(成功率/连败/挂死)+ 采集计划
 * (登记表日历/常驻 tick/渠道间隔)。?t= 切视图,默认总览。
 */
import RunHealth from "@/components/admin/data/RunHealth";
import RunJobs from "@/components/admin/data/RunJobs";
import RunOverview from "@/components/admin/data/RunOverview";
import RunPlan from "@/components/admin/data/RunPlan";
import SubTabs from "@/components/admin/data/SubTabs";
import { requireAdminPage } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

const TABS = [
  ["overview", "总览"],
  ["jobs", "日志"],
  ["health", "健康"],
  ["plan", "计划"],
] as const;

export default async function AdminDataRunPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; key?: string; status?: string; page?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const sp = await searchParams;
  const t = TABS.some(([k]) => k === sp.t) ? (sp.t as (typeof TABS)[number][0]) : "overview";
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">运行</h2>
        <p className="mt-0.5 text-xs text-text-3">
          跑了什么、跑得怎样:总览看强度/队列/错误,日志看批任务每轮明细,健康看成败与挂死,计划看全部排程;源的启停回「源管理」。
        </p>
      </div>
      <SubTabs tabs={TABS} active={t} basePath="/admin/data/run/" />
      {t === "overview" ? (
        <RunOverview />
      ) : t === "jobs" ? (
        <RunJobs sp={sp} />
      ) : t === "health" ? (
        <RunHealth />
      ) : (
        <RunPlan />
      )}
    </div>
  );
}
