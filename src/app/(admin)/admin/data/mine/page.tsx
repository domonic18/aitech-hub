/**
 * 数据中心·挖掘页(挖掘段,管线终点):候选治理(B站候选人工终审,批准即登记
 * 进博主台账)+ 博主台账 + 项目(GitHub 白名单)台账。?t= 切视图,默认候选治理。
 */
import MineBloggers from "@/components/admin/data/MineBloggers";
import MineCandidates from "@/components/admin/data/MineCandidates";
import MineGithub from "@/components/admin/data/MineGithub";
import SubTabs from "@/components/admin/data/SubTabs";
import { requireAdminPage } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

const TABS = [
  ["candidates", "候选治理"],
  ["bloggers", "博主"],
  ["github", "项目"],
] as const;

export default async function AdminDataMinePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; status?: string; page?: string; kw?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const sp = await searchParams;
  const t = TABS.some(([k]) => k === sp.t) ? (sp.t as (typeof TABS)[number][0]) : "candidates";
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">挖掘</h2>
        <p className="mt-0.5 text-xs text-text-3">
          洞察产出的词在「源管理·词库」生效后,在此触发发现并人工终审;批准博主候选即登记进博主台账。
        </p>
      </div>
      <SubTabs tabs={TABS} active={t} basePath="/admin/data/mine/" />
      {t === "candidates" ? (
        <MineCandidates searchParams={sp} />
      ) : t === "bloggers" ? (
        <MineBloggers />
      ) : (
        <MineGithub />
      )}
    </div>
  );
}
