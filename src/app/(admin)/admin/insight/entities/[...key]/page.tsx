/**
 * 洞察中心·实体详情(M59 批B → M60 别名/层次):/admin/insight/entities/<key>/。
 * key 可为规范键、任一别名或分隔符变体(同实体不同写法),统一解析到主实体;
 * 命中已归并实体则跳到归并目标(canonical 链接)。非法形态(大写/空格/保留
 * 字符/点段)与查无实体一律 404——实体 key 由抽取链 normalize 后写入,
 * 不存在「错 slug 归一」的语义。
 */
import { notFound, redirect } from "next/navigation";

import EntityDetailView from "@/components/admin/insight/EntityDetail";
import { requireAdminPage } from "@/lib/auth/guard";
import { entityHref, getEntityDetail, isCanonicalEntityKey } from "@/lib/insight/entities-admin";

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
  if (detail.redirectTo !== null) redirect(entityHref(detail.redirectTo));
  return <EntityDetailView detail={detail} />;
}
