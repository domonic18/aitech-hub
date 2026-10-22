/**
 * 贴图仓储(M41):content_pin CRUD、状态机流转、有序图片序列管理、
 * 公开读(published 瀑布流/详情)。完整性口径:topicId / versionId 均 soft ref
 * 应用层校验,不设跨域 FK(同 topic.linked_post_id 口径);工坊版本挂载时
 * 快照 media_path,升版由人工重挂。
 */
import { Prisma, type ContentPin } from "@prisma/client";

import { asciiSlugFromTitle, pinPathSegment } from "../content/pin-path";
import { prisma } from "../db";
import { prerenderSafe } from "../prerender-safe";
import { PIN_IMAGES_MAX, PIN_MANUAL_TARGETS, type PinStatus } from "./constants";
import type { PinCreateInput, PinImageAddInput, PinUpdateInput } from "./schemas";

export type PinErrorCode =
  | "not_found"
  | "invalid_transition"
  | "edit_locked"
  | "image_overflow"
  | "version_not_found"
  | "invalid_input";

export class PinError extends Error {
  constructor(
    readonly code: PinErrorCode,
    message: string,
  ) {
    super(message);
  }
}

async function requirePin(id: bigint): Promise<ContentPin> {
  const pin = await prisma.contentPin.findUnique({ where: { id } });
  if (!pin) throw new PinError("not_found", "贴图不存在");
  return pin;
}

/** 已同步/已发布贴图禁直编内容(先撤回待验收;防公众号草稿与站内失同步) */
function assertEditable(status: string): void {
  if (status === "synced" || status === "published") {
    throw new PinError("edit_locked", "已同步/已发布贴图不可直接编辑,请先撤回待验收");
  }
}

export async function createPin(input: PinCreateInput): Promise<ContentPin> {
  return prisma.contentPin.create({
    data: {
      title: input.title,
      content: input.content ?? "",
      topicId: input.topicId == null ? null : BigInt(input.topicId),
      readMoreUrl: input.readMoreUrl ?? null,
      cropSpec: input.cropSpec ?? "1_1",
    },
  });
}

export async function deletePin(id: bigint): Promise<void> {
  const r = await prisma.contentPin.deleteMany({ where: { id } });
  if (r.count === 0) throw new PinError("not_found", "贴图不存在");
}

export async function updatePin(id: bigint, patch: PinUpdateInput): Promise<ContentPin> {
  const pin = await requirePin(id);
  assertEditable(pin.status);
  return prisma.contentPin.update({
    where: { id },
    data: {
      title: patch.title,
      content: patch.content,
      topicId:
        patch.topicId === undefined
          ? undefined
          : patch.topicId == null
            ? null
            : BigInt(patch.topicId),
      readMoreUrl: patch.readMoreUrl,
      cropSpec: patch.cropSpec,
    },
  });
}

/** 人工状态流转(合法性按 PIN_MANUAL_TARGETS;同态幂等) */
export async function setPinStatus(id: bigint, next: PinStatus): Promise<ContentPin> {
  const pin = await requirePin(id);
  const from = pin.status as PinStatus;
  if (from === next) return pin;
  if (!PIN_MANUAL_TARGETS[from].includes(next)) {
    throw new PinError("invalid_transition", `状态不可流转:${from} → ${next}`);
  }
  return prisma.contentPin.update({
    where: { id },
    data: {
      status: next,
      // 上架时间只在首进 published 落;回退再上架不覆盖首布时间
      publishedAt: next === "published" ? (pin.publishedAt ?? new Date()) : pin.publishedAt,
    },
  });
}

// ── 图片序列 ─────────────────────────────────────────────────────

/** 添加图片(工坊版本引用或本地上传快照),追加到序列尾;超 20 张拒 */
export async function addPinImages(id: bigint, input: PinImageAddInput): Promise<number> {
  const pin = await requirePin(id);
  assertEditable(pin.status);
  const existing = await prisma.contentPinImage.count({ where: { pinId: id } });

  if ("versionIds" in input) {
    const versions = await prisma.illustrationVersion.findMany({
      where: { id: { in: input.versionIds.map((v) => BigInt(v)) } },
      select: { id: true, mediaPath: true },
    });
    const byId = new Map(versions.map((v) => [v.id, v]));
    const missing = input.versionIds.filter((v) => !byId.has(BigInt(v)));
    if (missing.length > 0) {
      throw new PinError("version_not_found", `工坊版本不存在:${missing.join(",")}`);
    }
    if (existing + input.versionIds.length > PIN_IMAGES_MAX) {
      throw new PinError("image_overflow", `图片序列上限 ${PIN_IMAGES_MAX} 张`);
    }
    await prisma.contentPinImage.createMany({
      data: input.versionIds.map((v, i) => {
        const ver = byId.get(BigInt(v))!;
        return {
          pinId: id,
          versionId: ver.id,
          mediaPath: ver.mediaPath,
          sortOrder: existing + i,
        };
      }),
    });
    return input.versionIds.length;
  }

  if (existing + 1 > PIN_IMAGES_MAX) {
    throw new PinError("image_overflow", `图片序列上限 ${PIN_IMAGES_MAX} 张`);
  }
  await prisma.contentPinImage.create({
    data: {
      pinId: id,
      versionId: null,
      mediaPath: input.mediaPath,
      width: input.width ?? null,
      height: input.height ?? null,
      sortOrder: existing,
    },
  });
  return 1;
}

/** 序列重排(全量 id 有序数组;校验归属一致) */
export async function reorderPinImages(id: bigint, orderedIds: string[]): Promise<void> {
  const rows = await prisma.contentPinImage.findMany({ where: { pinId: id } });
  const owned = new Set(rows.map((r) => r.id.toString()));
  if (orderedIds.length !== rows.length || !orderedIds.every((v) => owned.has(v))) {
    throw new PinError("not_found", "序列清单与当前图片不一致,请刷新后重试");
  }
  await prisma.$transaction(
    orderedIds.map((v, i) =>
      prisma.contentPinImage.update({
        where: { id: BigInt(v) },
        data: { sortOrder: i },
      }),
    ),
  );
}

export async function removePinImage(id: bigint, imageId: bigint): Promise<void> {
  const pin = await requirePin(id);
  assertEditable(pin.status);
  const r = await prisma.contentPinImage.deleteMany({ where: { id: imageId, pinId: id } });
  if (r.count === 0) throw new PinError("not_found", "图片不存在或不属于该贴图");
}

// ── 列表/详情 ────────────────────────────────────────────────────

export interface PinListQuery {
  status?: PinStatus;
  q?: string;
  page?: number;
  pageSize?: number;
}

export type PinWithMeta = ContentPin & {
  _count: { images: number };
  coverPath: string | null;
  topicTitle: string | null;
};

/** admin 列表(状态分段 + 标题搜索 + 分页):附首图封面与专题名(soft ref 二次解析) */
export async function listPins(
  q: PinListQuery = {},
): Promise<{ items: PinWithMeta[]; total: number }> {
  const pageSize = q.pageSize ?? 12;
  const page = Math.max(1, q.page ?? 1);
  const where: Prisma.ContentPinWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.q ? { title: { contains: q.q, mode: "insensitive" } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.contentPin.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        _count: { select: { images: true } },
        images: { orderBy: { sortOrder: "asc" }, take: 1, select: { mediaPath: true } },
      },
    }),
    prisma.contentPin.count({ where }),
  ]);
  const topicIds = [...new Set(rows.map((r) => r.topicId).filter((v): v is bigint => v !== null))];
  const topics = topicIds.length
    ? await prisma.topic.findMany({
        where: { id: { in: topicIds } },
        select: { id: true, title: true },
      })
    : [];
  const topicTitle = new Map(topics.map((t) => [t.id, t.title]));
  return {
    items: rows.map((r) => ({
      ...r,
      coverPath: r.images[0]?.mediaPath ?? null,
      topicTitle: r.topicId ? (topicTitle.get(r.topicId) ?? null) : null,
    })),
    total,
  };
}

/** 某创作项目的贴图产出(M42 创作中心产出区):首图封面 + 张数,更新时间倒序 */
export async function listPinsByTopic(topicId: bigint): Promise<
  {
    id: bigint;
    title: string;
    status: string;
    imageCount: number;
    coverPath: string | null;
    updatedAt: Date;
  }[]
> {
  const rows = await prisma.contentPin.findMany({
    where: { topicId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { images: true } },
      images: { orderBy: { sortOrder: "asc" }, take: 1, select: { mediaPath: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    imageCount: r._count.images,
    coverPath: r.images[0]?.mediaPath ?? null,
    updatedAt: r.updatedAt,
  }));
}

/** 状态分段计数(工作台页签角标) */
export async function countPinsByStatus(): Promise<Record<PinStatus | "all", number>> {
  const grouped = await prisma.contentPin.groupBy({ by: ["status"], _count: { _all: true } });
  const out: Record<string, number> = { all: 0 };
  for (const g of grouped) {
    out[g.status] = g._count._all;
    out.all += g._count._all;
  }
  return out as Record<PinStatus | "all", number>;
}

export async function getPinDetail(id: bigint) {
  const pin = await prisma.contentPin.findUnique({
    where: { id },
    include: {
      images: { orderBy: { sortOrder: "asc" } },
      channels: true,
    },
  });
  return pin;
}

// ── 公开读(published 瀑布流/详情,ISR 取数)─────────────────────

export async function listPublishedPins(q: { page?: number; pageSize?: number } = {}) {
  const pageSize = q.pageSize ?? 24;
  const page = Math.max(1, q.page ?? 1);
  return prerenderSafe("pins.published", { items: [], total: 0 }, async () => {
    const [rows, total] = await Promise.all([
      prisma.contentPin.findMany({
        where: { status: "published" },
        orderBy: { publishedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: { select: { images: true } },
          images: {
            orderBy: { sortOrder: "asc" },
            take: 1,
            select: { mediaPath: true, width: true, height: true },
          },
        },
      }),
      prisma.contentPin.count({ where: { status: "published" } }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        content: r.content,
        publishedAt: r.publishedAt,
        coverPath: r.images[0]?.mediaPath ?? null,
        coverWidth: r.images[0]?.width ?? null,
        coverHeight: r.images[0]?.height ?? null,
        imageCount: r._count?.images ?? 0,
      })),
      total,
    };
  });
}

/** /pins/[segment] 详情(published only;运行时 ISR 取数,同 getPostById 口径) */
export async function getPublishedPin(id: bigint) {
  return prisma.contentPin.findFirst({
    where: { id, status: "published" },
    include: { images: { orderBy: { sortOrder: "asc" } } },
  });
}

/** /pins/[segment] generateStaticParams 数据源(canonical 段;构建期无库降级按需 ISR) */
export async function listPinSegmentsForPrerender(): Promise<string[]> {
  try {
    const rows = await prisma.contentPin.findMany({
      where: { status: "published" },
      select: { id: true, title: true },
    });
    return rows.map((r) => pinPathSegment(r.id, asciiSlugFromTitle(r.title)));
  } catch (e) {
    console.warn(JSON.stringify({ event: "pins.prerender.degraded", error: String(e) }));
    return [];
  }
}

/** sitemap 全量投影(轻字段;slug 由标题派生,同 pinPath 口径) */
export async function listPublishedPinsForSeo() {
  return prerenderSafe("pins.allForSeo", [], () =>
    prisma.contentPin.findMany({
      where: { status: "published" },
      select: { id: true, title: true, updatedAt: true },
      orderBy: { publishedAt: "desc" },
    }),
  );
}
