/**
 * 洞察中心·信号(M59 批A):原始信号流的独立榜单页。原先埋在总览页末尾的
 * 折叠「信号明细」迁出至此——源/地域/介质/日期筛选 + 分页 + 原文外链。
 * 取数在页侧一次装配(服务端直查,不设读 API)。
 */
import SignalsBoard from "@/components/admin/insight/SignalsBoard";
import { requireAdminPage } from "@/lib/auth/guard";
import { listInsightSignalsPage } from "@/lib/insight/admin";
import { resolveSignalFilters, signalRange } from "@/lib/insight/signals-view";

export const dynamic = "force-dynamic";

export default async function AdminInsightSignalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const filters = resolveSignalFilters(await searchParams);
  const { from, to } = signalRange(filters);
  const data = await listInsightSignalsPage({
    source: filters.source,
    medium: filters.medium,
    region: filters.region,
    from,
    to,
    page: filters.page,
  });
  return <SignalsBoard data={data} filters={filters} />;
}
