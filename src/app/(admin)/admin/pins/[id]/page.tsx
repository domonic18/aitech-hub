/**
 * 贴图组装台(M41):单贴图的序列编排/预览裁剪/元数据/状态流转/渠道同步控制面。
 * 服务端直取 repo 详情 + 两个下拉数据源(专题、工坊根版本候选,不经 API,同
 * 列表页口径);BigInt/Date 经 dto 投影为可序列化形态再传客户端。
 */
import { notFound } from "next/navigation";

import { prisma } from "@/lib/db";
import PinEditor from "@/components/admin/pins/PinEditor";
import { requireAdminPage } from "@/lib/auth/guard";
import { toPinChannelDto, toPinDto, toPinImageDto, type PinDetailDto } from "@/lib/pins/dto";
import { getPinDetail } from "@/lib/pins/repo";

export const dynamic = "force-dynamic";

const ID_RE = /^\d{1,10}$/;

export default async function AdminPinEditorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  if (!ID_RE.test(id)) notFound();
  const pin = await getPinDetail(BigInt(id));
  if (!pin) notFound();
  const [topics, workshopRoots] = await Promise.all([
    prisma.topic.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, title: true },
    }),
    // 工坊根版本候选(首图加工的原图,非编辑产物;新候选刷新页面可见)
    prisma.illustrationVersion.findMany({
      where: { parentVersionId: null },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: { id: true, mediaPath: true, origin: true },
    }),
  ]);
  const detail: PinDetailDto = {
    ...toPinDto(pin, pin.images.length),
    images: pin.images.map(toPinImageDto),
    channels: pin.channels.map(toPinChannelDto),
  };
  return (
    <PinEditor
      initial={detail}
      topics={topics.map((t) => ({ id: t.id.toString(), title: t.title }))}
      workshopRoots={workshopRoots.map((v) => ({
        id: v.id.toString(),
        mediaPath: v.mediaPath,
        origin: v.origin,
      }))}
    />
  );
}
