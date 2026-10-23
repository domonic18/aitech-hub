/**
 * 洞察中心·发现(F10 壳板):种子词库(F23)/ 发现任务 / 候选治理(F24)/
 * 项目发现 四段,?t= 切换默认词库。各段自带页头与 hint(板 F23/F10 分段
 * 各有标题);任务入队后由 worker 执行,结果见候选治理与 运行 › 日志;
 * 手动触发统一在 源管理·台账 行内(板 note)。
 */
import MineGithub from "@/components/admin/data/MineGithub";
import WordsBoard from "@/components/admin/discovery/WordsBoard";
import SubTabs from "@/components/admin/data/SubTabs";
import { requireAdminPage } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

const TABS = [
  ["words", "种子词库"],
  ["jobs", "发现任务"],
  ["candidates", "候选治理"],
  ["github", "项目发现"],
] as const;

export default async function AdminInsightDiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<{
    t?: string;
    status?: string;
    page?: string;
    kw?: string;
    origin?: string;
  }>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const sp = await searchParams;
  const t = TABS.some(([k]) => k === sp.t) ? (sp.t as (typeof TABS)[number][0]) : "words";
  return (
    <div className="flex flex-col gap-4">
      <SubTabs tabs={TABS} active={t} basePath="/admin/insight/discovery/" />
      {t === "words" ? (
        <WordsBoard searchParams={sp} />
      ) : t === "jobs" ? (
        <DiscoveryJobs />
      ) : t === "candidates" ? (
        <CandidateReview />
      ) : (
        <MineGithub />
      )}
    </div>
  );
}

/** 发现任务段(W6 贴板:任务卡+最近运行表);骨架期占位 */
function DiscoveryJobs(): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-panel px-4 py-10 text-center text-xs text-text-3">
      发现任务运行台账迁入中
    </div>
  );
}

/** 候选治理段(W6 贴板:F24 词候选卡+KPI);骨架期占位 */
function CandidateReview(): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-panel px-4 py-10 text-center text-xs text-text-3">
      候选治理迁入中
    </div>
  );
}
