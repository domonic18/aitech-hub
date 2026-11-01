/**
 * 贴图公开读(M47 批D 自 repo.ts 切出,拆文件守 350 行线):published
 * 瀑布流/详情/预渲染清单/sitemap 投影,ISR 取数。兼容出口住 repo.ts。
 *
 * 2026-11-01 文章列表重构:公开口径统一带 `publishedAt: { not: null }`——
 * 此前只按 status 过滤,库里若残留「已发布但未落上架时间」的脏行,会在
 * `orderBy publishedAt desc` 下被 NULLS FIRST 顶到最前(列表/瀑布流/sitemap 同错)。
 * 投影/取数收口为 PIN_PUBLISHED_WHERE + toPinListItem,合并流复用同一份。
 */
import { asciiSlugFromTitle, pinPathSegment } from "../content/pin-path";
import { prisma } from "../db";
import { logWarn } from "../logger";
import { prerenderSafe } from "../prerender-safe";

export const PIN_PUBLISHED_WHERE = { status: "published", publishedAt: { not: null } } as const;

const PIN_LIST_INCLUDE = {
  _count: { select: { images: true } },
  images: {
    orderBy: { sortOrder: "asc" },
    take: 1,
    select: { mediaPath: true, width: true, height: true },
  },
} as const;

/** 列表/合并流共用投影(单张封面 + 图数) */
export interface PinListItem {
  id: bigint;
  title: string;
  content: string;
  publishedAt: Date;
  coverPath: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
  imageCount: number;
}

interface PinListRow {
  id: bigint;
  title: string;
  content: string;
  publishedAt: Date | null;
  _count: { images: number };
  images: { mediaPath: string; width: number | null; height: number | null }[];
}

function toPinListItem(r: PinListRow): PinListItem | null {
  // where 已挡 null;此处收窄类型并兜底(防御未来新增查询忘了带 where)
  if (!r.publishedAt) return null;
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    publishedAt: r.publishedAt,
    coverPath: r.images[0]?.mediaPath ?? null,
    coverWidth: r.images[0]?.width ?? null,
    coverHeight: r.images[0]?.height ?? null,
    imageCount: r._count.images,
  };
}

export async function listPublishedPins(q: { page?: number; pageSize?: number } = {}) {
  const pageSize = q.pageSize ?? 24;
  const page = Math.max(1, q.page ?? 1);
  return prerenderSafe("pins.published", { items: [], total: 0 }, async () => {
    const [rows, total] = await Promise.all([
      prisma.contentPin.findMany({
        where: PIN_PUBLISHED_WHERE,
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: PIN_LIST_INCLUDE,
      }),
      prisma.contentPin.count({ where: PIN_PUBLISHED_WHERE }),
    ]);
    return {
      items: rows.flatMap((r) => {
        const item = toPinListItem(r);
        return item ? [item] : [];
      }),
      total,
    };
  });
}

/** 合并流用:取时间序前 limit 条(不分页);total 由 countPublishedPinsForFeed 单独取 */
export async function listPublishedPinsHead(limit: number): Promise<PinListItem[]> {
  return prerenderSafe("pins.head", [], async () => {
    const rows = await prisma.contentPin.findMany({
      where: PIN_PUBLISHED_WHERE,
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: limit,
      include: PIN_LIST_INCLUDE,
    });
    return rows.flatMap((r) => {
      const item = toPinListItem(r);
      return item ? [item] : [];
    });
  });
}

/** 合并流用:已发布贴图总数 */
export async function countPublishedPinsForFeed(): Promise<number> {
  return prerenderSafe("pins.countForFeed", 0, () =>
    prisma.contentPin.count({ where: PIN_PUBLISHED_WHERE }),
  );
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
    logWarn("pins.prerender.degraded", { error: e });
    return [];
  }
}

/** sitemap 全量投影(轻字段;slug 由标题派生,同 pinPath 口径) */
export async function listPublishedPinsForSeo() {
  return prerenderSafe("pins.allForSeo", [], () =>
    prisma.contentPin.findMany({
      where: PIN_PUBLISHED_WHERE,
      select: { id: true, title: true, updatedAt: true },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    }),
  );
}
