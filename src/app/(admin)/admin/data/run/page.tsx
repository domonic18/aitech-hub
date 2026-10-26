/**
 * 数据中心·运行页(执行呈现段,IA v5 板定 F18 日志/F19 健康/F20 实时):
 * 实时采集(强度/队列/依赖)+ 任务日志(job_run 台账明细)+ 健康聚合
 * (成功率/连败/挂死)。?t= 切视图,默认实时;计划视图已升独立页签
 * /admin/data/plan(旧 ?t=plan 经 next.config 308)。
 */
import RunHealth from "@/components/admin/data/RunHealth";
import RunJobs from "@/components/admin/data/RunJobs";
import RunOverview from "@/components/admin/data/RunOverview";
import SubTabs from "@/components/admin/data/SubTabs";
import { requireAdminPage } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

const TABS = [
  ["overview", "实时采集"],
  ["jobs", "采集日志"],
  ["health", "健康度"],
] as const;

export default async function AdminDataRunPage({
  searchParams,
}: {
  searchParams: Promise<{
    t?: string;
    key?: string;
    status?: string;
    range?: string;
    page?: string;
  }>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const sp = await searchParams;
  const t = TABS.some(([k]) => k === sp.t) ? (sp.t as (typeof TABS)[number][0]) : "overview";
  const HINTS: Record<(typeof TABS)[number][0], string> = {
    overview: "跑了什么、跑得怎样:实时看当前采集与队列,源的启停回「源管理」,排程看「计划」。",
    jobs: "job_run 全量执行流水 · 触发方式 cron / manual · 运行中每 3 秒自动刷新",
    health: "统一口径:连败 ≥2 红 · 24h 成功率 <80% 琥珀 · 7 日无成功 · 静默超时",
  };
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">运行</h2>
        <p className="mt-0.5 text-xs text-text-3">{HINTS[t]}</p>
      </div>
      <SubTabs tabs={TABS} active={t} basePath="/admin/data/run/" />
      {t === "overview" ? <RunOverview /> : t === "jobs" ? <RunJobs sp={sp} /> : <RunHealth />}
    </div>
  );
}
