/**
 * 编辑器「从媒体库插入」选图窄口读侧(2026-10-15 验收反馈问题三):
 * 只出可直接插正文且缩略图已就绪的图片(worker sharp 管线处理完 status=active),
 * 不涉引用统计/回收站面(listMediaAdmin 是全库引用聚合的重查询,选图弹窗不走它;
 * queries.ts 已近行数上限,选图面独立成文件)。
 */
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { MEDIA_PAGE_SIZE } from "@/lib/media/queries";

export interface MediaPickerItem {
  id: string;
  path: string;
  filename: string;
  thumbPath: string | null;
  width: number | null;
  height: number | null;
  createdAt: Date;
}

/** 图片选择清单:文件名搜索 + 分页(createdAt 倒序,新图在前) */
export async function listImagesForPicker(query: {
  q?: string;
  page: number;
}): Promise<{ items: MediaPickerItem[]; total: number; page: number }> {
  const where: Prisma.MediaWhereInput = {
    kind: "image",
    deletedAt: null,
    status: "active", // thumb/宽高已回填;processing/error 不进选图面
  };
  if (query.q) where.filename = { contains: query.q };
  const [rows, total] = await prisma.$transaction([
    prisma.media.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * MEDIA_PAGE_SIZE,
      take: MEDIA_PAGE_SIZE,
    }),
    prisma.media.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id.toString(),
      path: r.path,
      filename: r.filename,
      thumbPath: r.thumbPath,
      width: r.width,
      height: r.height,
      createdAt: r.createdAt,
    })),
    total,
    page: query.page,
  };
}
