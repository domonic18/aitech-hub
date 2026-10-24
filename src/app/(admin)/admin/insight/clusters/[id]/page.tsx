/**
 * 簇详情路由(F25/F26 双形态,W7 拆分):hot → ClusterHotDetail(机会分卡+
 * 8 周趋势+核心词表),pain → ClusterPainDetail(概括卡+原文证据+关联机会簇)。
 * 本页只做鉴权、参数解析(w∈7|30|90 缺省 7,钳核心词频次窗宽)与形态分发。
 */
import { notFound } from "next/navigation";

import ClusterHotDetail from "@/components/admin/insight/ClusterHotDetail";
import ClusterPainDetail from "@/components/admin/insight/ClusterPainDetail";
import { WINDOWS } from "@/components/admin/insight/shared";
import { requireAdminPage } from "@/lib/auth/guard";
import { getInsightClusterExtras } from "@/lib/insight/cluster-extras";
import { getInsightClusterDetail } from "@/lib/insight/admin";

export const dynamic = "force-dynamic";

export default async function AdminInsightClusterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ w?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const bigId = BigInt(id);
  const detail = await getInsightClusterDetail(bigId);
  if (detail === null) notFound();
  const sp = await searchParams;
  const windowDays = WINDOWS.some((n) => String(n) === sp.w) ? Number(sp.w) : 7;
  const extras = await getInsightClusterExtras(bigId, detail.cluster.keywords, windowDays);

  return detail.cluster.kind === "hot" ? (
    <ClusterHotDetail detail={detail} extras={extras} windowDays={windowDays} />
  ) : (
    <ClusterPainDetail detail={detail} extras={extras} />
  );
}
