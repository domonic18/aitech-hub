/**
 * 洞察中心·实体(M59 批B → M60 实体层):按规范实体聚合厂商事件的列表页
 * (品牌分区 → 产品线 → 实体)。取数在页侧一次装配(服务端直查,不设读 API);
 * 筛选值经纯函数钳制。
 */
import EntitiesBoard from "@/components/admin/insight/EntitiesBoard";
import { requireAdminPage } from "@/lib/auth/guard";
import { listEntityTree, resolveEntityFilters } from "@/lib/insight/entities-admin";

export const dynamic = "force-dynamic";

export default async function AdminInsightEntitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const filters = resolveEntityFilters(await searchParams);
  const data = await listEntityTree(filters);
  return <EntitiesBoard data={data} filters={filters} />;
}
