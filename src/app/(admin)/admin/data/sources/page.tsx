/**
 * 数据中心·源管理页(IA v5 板定 F17/F27):采集对象与渠道统一台账——
 * 采集渠道(渠道/热榜/发现/GitHub 五类行,F17)、博主台账(F27,与渠道
 * 同级)、博主候选池(审核通过后入博主台账)。?t= 切段,默认采集渠道;
 * 种子词库已迁洞察中心(/admin/insight/discovery?t=words,308 承接)。
 */
import ChannelLedger from "@/components/admin/data/ChannelLedger";
import MineBloggers from "@/components/admin/data/MineBloggers";
import MineCandidates from "@/components/admin/data/MineCandidates";
import SubTabs from "@/components/admin/SubTabs";
import { parseSubTab } from "@/components/admin/subtab";
import { requireAdminPage } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

const TABS = [
  ["channels", "采集渠道"],
  ["bloggers", "博主台账"],
  ["candidates", "博主候选池"],
] as const;

export default async function AdminDataSourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; status?: string; page?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const sp = await searchParams;
  const t = parseSubTab(TABS, sp.t, "channels");
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">源管理</h2>
        <p className="mt-0.5 text-xs text-text-3">
          采集对象与渠道统一台账 · 博主与渠道同级,新增经 博主候选池 审核后入此
        </p>
      </div>
      <SubTabs tabs={TABS} active={t} basePath="/admin/data/sources/" />
      {t === "channels" ? (
        <ChannelLedger />
      ) : t === "bloggers" ? (
        <MineBloggers />
      ) : (
        <MineCandidates searchParams={sp} />
      )}
    </div>
  );
}
