/**
 * 数据中心·源管理页(管线起点·配置段):三类源一条龙——渠道(crawl_source,
 * 启停/频率/健康)、热榜源(insight_hot_source,启停/回写)、词库
 * (discovery_keyword,生效词=发现搜索源)。?t= 切视图,默认渠道。
 */
import SourceChannels from "@/components/admin/data/SourceChannels";
import SourceHot from "@/components/admin/data/SourceHot";
import SourceWords from "@/components/admin/data/SourceWords";
import SubTabs from "@/components/admin/data/SubTabs";
import { requireAdminPage } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

const TABS = [
  ["channels", "渠道"],
  ["hot", "热榜源"],
  ["words", "词库"],
] as const;

export default async function AdminDataSourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; status?: string; page?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const sp = await searchParams;
  const t = TABS.some(([k]) => k === sp.t) ? (sp.t as (typeof TABS)[number][0]) : "channels";
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">源管理</h2>
        <p className="mt-0.5 text-xs text-text-3">
          管线起点:采集与发现的所有「源」在此登记启停;跑了多少、跑得怎样看「运行」,产出了什么看「洞察」。
        </p>
      </div>
      <SubTabs tabs={TABS} active={t} basePath="/admin/data/sources/" />
      {t === "channels" ? (
        <SourceChannels />
      ) : t === "hot" ? (
        <SourceHot />
      ) : (
        <SourceWords searchParams={sp} />
      )}
    </div>
  );
}
