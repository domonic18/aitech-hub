/**
 * 配图工坊编辑器页(M40 批 B,arch/05 §4.7):会话门 requireAdminPage +
 * 服务端取数(版本链/最新图层组)→ 交互编排交 IllustrationStudio 客户端件。
 * agent generate_illustration 回执的 studio 链接直达本页。
 */
import { notFound } from "next/navigation";

import IllustrationStudio from "@/components/admin/illustration/IllustrationStudio";
import { getStudioView } from "@/lib/ai/illustration-studio";
import { requireAdminPage } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function AdminIllustrationStudioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const view = await getStudioView(BigInt(id));
  if (!view) notFound();
  return <IllustrationStudio initialView={view} />;
}
