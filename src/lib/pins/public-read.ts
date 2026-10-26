/**
 * 贴图公开读(M47 批D 自 repo.ts 切出,拆文件守 350 行线):published
 * 瀑布流/详情/预渲染清单/sitemap 投影,ISR 取数。兼容出口住 repo.ts。
 */
import { asciiSlugFromTitle, pinPathSegment } from "../content/pin-path";
import { prisma } from "../db";
import { prerenderSafe } from "../prerender-safe";

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
