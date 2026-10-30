/**
 * 洞察中心·事件(M58 批②,data-expansion-plan §5.3):厂商官方发布经事件抽取
 * 落 entity_event 的台账;按厂商/类型/时间筛选,标题外链原文。采集侧入口在
 * 数据中心·源管理·采集渠道(vendor 渠道行),本页只读。
 */
import EventsBoard from "@/components/admin/insight/EventsBoard";
import { requireAdminPage } from "@/lib/auth/guard";
import { listEntityEvents, resolveEventFilters } from "@/lib/insight/events-admin";

export const dynamic = "force-dynamic";

export default async function AdminInsightEventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const filters = resolveEventFilters(await searchParams);
  const rows = await listEntityEvents(filters);
  return <EventsBoard rows={rows} filters={filters} />;
}
