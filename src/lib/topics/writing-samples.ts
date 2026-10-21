/**
 * 样例参照图库(M39 批③ §13.11):writing_sample_image 行治理——上传登记/
 * 清单/重命名/删除。删除事务内先置空 topic.sample_image_id 引用(soft ref
 * 应用层完整性,同 linked_post_id 口径);媒体文件归媒体库治理(sha1 去重、
 * 可能被正文引用),删行不连带。
 */
import { prisma } from "../db";

export interface WritingSampleDto {
  id: string;
  name: string;
  mediaPath: string;
  createdAt: string;
}

/** 展示名默认取上传文件名去扩展(空回落「样例参照图」),截断到列宽 100;
 * 先 trim 再剥扩展(带前导空格的文件名否则剥不中) */
export function deriveSampleName(filename: string): string {
  const base = filename
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .trim();
  return (base || "样例参照图").slice(0, 100);
}

function toDto(row: {
  id: bigint;
  name: string;
  mediaPath: string;
  createdAt: Date;
}): WritingSampleDto {
  return {
    id: row.id.toString(),
    name: row.name,
    mediaPath: row.mediaPath,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listWritingSamples(): Promise<WritingSampleDto[]> {
  const rows = await prisma.writingSampleImage.findMany({ orderBy: [{ createdAt: "desc" }] });
  return rows.map(toDto);
}

export async function createWritingSample(
  name: string,
  mediaPath: string,
): Promise<WritingSampleDto> {
  return toDto(await prisma.writingSampleImage.create({ data: { name, mediaPath } }));
}

export async function renameWritingSample(
  id: bigint,
  name: string,
): Promise<WritingSampleDto | null> {
  const row = await prisma.writingSampleImage
    .update({ where: { id }, data: { name } })
    .catch(() => null);
  return row ? toDto(row) : null;
}

/** 删图库行:事务置空引用后删行;返回 false=行不存在(404);媒体不连带 */
export async function deleteWritingSample(id: bigint): Promise<boolean> {
  const [, del] = await prisma.$transaction([
    prisma.topic.updateMany({ where: { sampleImageId: id }, data: { sampleImageId: null } }),
    prisma.writingSampleImage.deleteMany({ where: { id } }),
  ]);
  return del.count > 0;
}
