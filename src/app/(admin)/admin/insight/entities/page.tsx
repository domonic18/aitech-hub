/**
 * 洞察中心·实体(M59 批B):按 entityKey 聚合厂商事件的列表页。
 * 取数在页侧一次装配(服务端直查,不设读 API);筛选值经纯函数钳制。
 */
import EntitiesBoard from "@/components/admin/insight/EntitiesBoard";
import { requireAdminPage } from "@/lib/auth/guard";
import { listEntities, resolveEntityFilters } from "@/lib/insight/entities-admin";

export const dynamic = "force-dynamic";

export default async function AdminInsightEntitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const filters = resolveEntityFilters(await searchParams);
  const data = await listEntities(filters);
  return <EntitiesBoard data={data} filters={filters} />;
}
