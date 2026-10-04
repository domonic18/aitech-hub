/**
 * GitHub 项目展示前台公开读侧(M11 批③):展示列表/首页 rail/详情(含配套
 * 文章)/进展动态时间轴/SEO 清单。全部 prerenderSafe(Docker/CI 构建无 DB
 * 降级为空数据,arch/07-frontend §1)+ 显式 select——readmeMd 大字段只在
 * getProjectBySlug 单点取出,列表/SEO 路径零大列。
 */
import { prisma } from "../db";
import { prerenderSafe } from "../prerender-safe";

const REPO_LIST_SELECT = {
  id: true,
  fullName: true,
  slug: true,
  description: true,
  stars: true,
  forks: true,
  language: true,
  topics: true,
  htmlUrl: true,
  homepage: true,
  updatedAt: true,
} as const;

/** 展示列表(sortOrder 人工优先,平手 stars 降序;配套文章计数随行) */
export function listShowcaseRepos(limit?: number) {
  return prerenderSafe("github.showcase", [], () =>
    prisma.githubRepo.findMany({
      where: { display: true },
      select: { ...REPO_LIST_SELECT, _count: { select: { posts: true } } },
      orderBy: [{ sortOrder: "asc" }, { stars: "desc" }, { id: "asc" }],
      ...(limit !== undefined ? { take: limit } : {}),
    }),
  );
}
export type ShowcaseRepo = Awaited<ReturnType<typeof listShowcaseRepos>>[number];

/** 详情(display=false 视为下架,同 404);含已发布配套文章与 README 缓存 */
export function getProjectBySlug(slug: string) {
  return prerenderSafe("github.project", null, () =>
    prisma.githubRepo.findFirst({
      where: { slug, display: true },
      select: {
        ...REPO_LIST_SELECT,
        readmeMd: true,
        defaultBranch: true,
        posts: {
          where: { post: { status: "published" } },
          orderBy: { post: { publishedAt: "desc" } },
          select: {
            postId: true,
            post: { select: { id: true, slug: true, title: true, excerpt: true } },
          },
        },
      },
    }),
  );
}
export type ProjectDetail = NonNullable<Awaited<ReturnType<typeof getProjectBySlug>>>;

/** 进展动态时间轴(裁剪管道已保证每仓 ≤50,详情页默认取 20) */
export function listRepoActivity(repoId: number, limit = 20) {
  return prerenderSafe("github.activity", [], () =>
    prisma.githubRepoActivity.findMany({
      where: { repoId },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: limit,
      select: { id: true, kind: true, title: true, url: true, author: true, occurredAt: true },
    }),
  );
}
export type RepoActivityItem = Awaited<ReturnType<typeof listRepoActivity>>[number];

/** SEO 清单(sitemap):slug + updatedAt,零大列 */
export function listProjectsForSeo() {
  return prerenderSafe("github.seo", [], () =>
    prisma.githubRepo.findMany({
      where: { display: true },
      select: { slug: true, updatedAt: true },
      orderBy: { id: "asc" },
    }),
  );
}

/** 星数口径(与 telegram 万单位 compactCount 刻意不同):≥1000 → 1.2k 形态 */
export function formatStars(stars: number): string {
  if (stars < 1000) return String(stars);
  const k = stars / 1000;
  const s = k >= 100 ? String(Math.round(k)) : k.toFixed(1).replace(/\.0$/, "");
  return `${s}k`;
}
