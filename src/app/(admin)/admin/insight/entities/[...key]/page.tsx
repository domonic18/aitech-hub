/**
 * 洞察中心·实体详情(M59 批B):/admin/insight/entities/<entityKey>/。
 * 用 catch-all 段承接(entityKey 允许 /,如 meta-llama/llama-4);非法形态
 * (大写/空格/保留字符/点段)与查无实体一律 404——实体 key 由抽取链 normalize
 * 后写入,不存在「错 slug 归一」的语义,故不做 308。
 */
import { notFound } from "next/navigation";

import EntityDetailView from "@/components/admin/insight/EntityDetail";
import { requireAdminPage } from "@/lib/auth/guard";
import { getEntityDetail, isCanonicalEntityKey } from "@/lib/insight/entities-admin";

export const dynamic = "force-dynamic";

export default async function AdminInsightEntityPage({
  params,
}: {
  params: Promise<{ key: string[] }>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const entityKey = (await params).key.join("/");
  if (!isCanonicalEntityKey(entityKey)) notFound();
  const detail = await getEntityDetail(entityKey);
  if (detail === null) notFound();
  return <EntityDetailView detail={detail} />;
}
