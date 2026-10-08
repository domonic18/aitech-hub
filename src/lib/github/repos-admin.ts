/**
 * GitHub 仓库台账管理(M11 批②,镜像 bloggers-admin 纪律):
 * 列表/登记/编辑/启停/上下架/两步武装删除/手动同步/配套文章关联。
 * 仅会话通道(PAT 禁管,路由层把守);slug 登记时派生此后冻结;
 * 登记时同步 GET /repos 校验存在性(404 → not_found;网络/限频不可达 →
 * 降级入库靠首轮同步补 meta)。GITHUB_TOKEN 值不入库不打日志。
 */
import { z } from "zod";

import { isP2002, prisma } from "../db";
import { logger } from "../logger";
import { GITHUB_JOB_SYNC, getQueue, QUEUE_GITHUB } from "../queue";

import { fetchRepoMeta } from "./api";
import { GITHUB_SYNC_INTERVAL_MIN } from "./constants";
import { GithubAdminError, GithubApiUnavailableError, GithubApiUpstreamError } from "./errors";
import { ensureUniqueProjectSlug } from "./project-slug";
import { revalidateProjectPaths } from "./revalidate";

export { GithubAdminError, type GithubAdminErrorCode } from "./errors";

/** owner(字母数字连字符,≤39)+ name(GitHub 允许 . _ -,≤100) */
const FULL_NAME_PATTERN = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/;

// ── 台账 ──────────────────────────────────────────────────────────────────────

/** 台账列表(白名单个位/十位数量级,不分页;readmeMd 大字段不出) */
export async function listReposAdmin() {
  const rows = await prisma.githubRepo.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: { _count: { select: { posts: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    slug: r.slug,
    description: r.description,
    stars: r.stars,
    forks: r.forks,
    language: r.language,
    topics: r.topics,
    htmlUrl: r.htmlUrl,
    homepage: r.homepage,
    display: r.display,
    sortOrder: r.sortOrder,
    enabled: r.enabled,
    syncIntervalMin: r.syncIntervalMin,
    lastSyncAt: r.lastSyncAt,
    nextSyncAt: r.nextSyncAt,
    consecutiveFails: r.consecutiveFails,
    lastError: r.lastError,
    status: r.status,
    postCount: r._count.posts,
    hasReadme: r.readmeMd !== null,
    remark: r.remark,
    createdAt: r.createdAt,
  }));
}
export type GithubRepoRow = Awaited<ReturnType<typeof listReposAdmin>>[number];

// ── 登记与编辑 ────────────────────────────────────────────────────────────────

export const RepoCreateSchema = z.object({
  fullName: z
    .string()
    .trim()
    .regex(FULL_NAME_PATTERN, "须为 owner/name 形态(如 domonic18/aitech-hub)"),
  syncIntervalMin: z.number().int().min(10).max(1440).optional(),
  remark: z.string().trim().max(200).nullable().optional(),
});

export const RepoUpdateSchema = z.object({
  syncIntervalMin: z.number().int().min(10).max(1440),
  sortOrder: z.number().int().min(0).max(9999),
  remark: z.string().trim().max(200).nullable().optional(),
});

/** 启停(enabled=调度)与上下架(display=前台)至少其一 */
export const RepoStatusSchema = z
  .object({ enabled: z.boolean().optional(), display: z.boolean().optional() })
  .refine((v) => v.enabled !== undefined || v.display !== undefined, {
    message: "enabled/display 至少一项",
  });

/** 配套文章关联:post id 字符串数组(BigInt 出入参一律字符串化,JSON 安全) */
export const RepoPostsSchema = z.object({
  postIds: z.array(z.string().regex(/^\d{1,20}$/)).max(50),
});

export async function createRepo(raw: z.infer<typeof RepoCreateSchema>): Promise<{ id: number }> {
  // 存在性校验:GitHub 404 直接拒;网络/限频不可达降级入库,靠首轮同步补 meta
  let meta: Awaited<ReturnType<typeof fetchRepoMeta>> | null = null;
  try {
    meta = await fetchRepoMeta(raw.fullName);
  } catch (err) {
    if (err instanceof GithubApiUpstreamError && err.status === 404) {
      throw new GithubAdminError("not_found", "GitHub 上不存在该仓库,请核对 owner/name");
    }
    if (!(err instanceof GithubApiUnavailableError)) throw err;
    logger.warn({ event: "github_repo.create_meta_degraded", fullName: raw.fullName });
  }

  // slug 由 name 段派生(此后冻结);fullName 用 GitHub canonical 大小写
  const name = (raw.fullName.split("/")[1] ?? "").trim();
  const slug = await ensureUniqueProjectSlug(name);
  try {
    const created = await prisma.githubRepo.create({
      data: {
        fullName: meta?.full_name ?? raw.fullName,
        slug,
        description: meta?.description ?? null,
        htmlUrl: meta?.html_url ?? `https://github.com/${raw.fullName}`,
        homepage: meta?.homepage ?? null,
        language: meta?.language ?? null,
        topics: meta?.topics ?? [],
        defaultBranch: meta?.default_branch || "main",
        stars: meta?.stargazers_count ?? 0,
        forks: meta?.forks_count ?? 0,
        syncIntervalMin: raw.syncIntervalMin ?? GITHUB_SYNC_INTERVAL_MIN,
        remark: raw.remark ?? null,
      },
      select: { id: true },
    });
    logger.info({ event: "github_repo.created", repoId: created.id, fullName: raw.fullName });
    revalidateProjectPaths(null);
    return created;
  } catch (e) {
    if (isP2002(e)) throw new GithubAdminError("duplicate", "该仓库已登记(full_name 重复)");
    throw e;
  }
}

export async function updateRepo(
  id: number,
  raw: z.infer<typeof RepoUpdateSchema>,
): Promise<{ id: number }> {
  const existing = await prisma.githubRepo.findUnique({ where: { id } });
  if (!existing) throw new GithubAdminError("not_found", "仓库不存在");
  const updated = await prisma.githubRepo.update({
    where: { id },
    data: {
      syncIntervalMin: raw.syncIntervalMin,
      sortOrder: raw.sortOrder,
      remark: raw.remark ?? null,
    },
    select: { id: true },
  });
  logger.info({ event: "github_repo.updated", repoId: id });
  // sortOrder 影响前台排序与首页 rail
  revalidateProjectPaths(existing.slug);
  return updated;
}

/** enabled=调度开关(停用不再同步);display=前台开关(下架不删数据) */
export async function setRepoStatus(
  id: number,
  patch: { enabled?: boolean; display?: boolean },
): Promise<void> {
  const row = await prisma.githubRepo.findUnique({
    where: { id },
    select: { id: true, slug: true },
  });
  if (!row) throw new GithubAdminError("not_found", "仓库不存在");
  await prisma.githubRepo.update({ where: { id }, data: patch });
  logger.info({ event: "github_repo.status_changed", repoId: id, ...patch });
  if (patch.display !== undefined) revalidateProjectPaths(row.slug);
}

/** 两步武装删除:调度启用中 409;物理删(activity/m2m 随 Cascade 清) */
export async function deleteRepo(id: number): Promise<void> {
  const row = await prisma.githubRepo.findUnique({
    where: { id },
    select: { id: true, enabled: true, display: true, fullName: true, slug: true },
  });
  if (!row) throw new GithubAdminError("not_found", "仓库不存在");
  if (row.enabled) {
    throw new GithubAdminError("enabled", "仓库启用中,先停用再删除(两步武装删除)");
  }
  await prisma.githubRepo.delete({ where: { id } });
  logger.info({ event: "github_repo.deleted", repoId: id, fullName: row.fullName });
  if (row.display) revalidateProjectPaths(row.slug);
}

/** 手动触发一轮同步(停用仓拒绝;入队即返回,结果看台账) */
export async function triggerRepoSync(id: number): Promise<{ enqueued: true }> {
  const row = await prisma.githubRepo.findUnique({
    where: { id },
    select: { id: true, enabled: true, fullName: true },
  });
  if (!row) throw new GithubAdminError("not_found", "仓库不存在");
  if (!row.enabled) throw new GithubAdminError("disabled", "仓库已停用,启用后再同步");
  await getQueue(QUEUE_GITHUB).add(
    GITHUB_JOB_SYNC,
    { repoId: row.id },
    {
      // 手动 job id 与调度 job(id 锚定 next_sync_at)不冲突;连字符形态禁冒号
      jobId: `github-sync-${row.id}-manual-${Date.now()}`,
      removeOnComplete: 200,
      removeOnFail: 200,
    },
  );
  logger.info({ event: "github_repo.sync_triggered", repoId: row.id, fullName: row.fullName });
  return { enqueued: true };
}

// ── 配套文章(m2m 手动关联)──────────────────────────────────────────────────

/**
 * 关联弹窗数据:全部已发布文章(published_at 倒序,至多 500 条防失控)+
 * 当前仓关联标记,单次请求供勾选;仓不存在 → not_found。
 */
export async function listRepoPostOptions(
  repoId: number,
): Promise<Array<{ id: string; title: string; linked: boolean }>> {
  const repo = await prisma.githubRepo.findUnique({
    where: { id: repoId },
    select: { id: true },
  });
  if (!repo) throw new GithubAdminError("not_found", "仓库不存在");
  const [posts, linked] = await Promise.all([
    prisma.post.findMany({
      where: { status: "published" },
      orderBy: { publishedAt: "desc" },
      select: { id: true, title: true },
      take: 500,
    }),
    prisma.githubRepoPost.findMany({ where: { repoId }, select: { postId: true } }),
  ]);
  const linkedSet = new Set(linked.map((l) => l.postId));
  return posts.map((p) => ({
    id: p.id.toString(),
    title: p.title,
    linked: linkedSet.has(p.id),
  }));
}

/** 整体替换关联(事务删旧插新);仅 published 文章,含不存在/草稿 → invalid */
export async function setRepoPosts(id: number, postIds: string[]): Promise<{ count: number }> {
  const repo = await prisma.githubRepo.findUnique({
    where: { id },
    select: { id: true, slug: true },
  });
  if (!repo) throw new GithubAdminError("not_found", "仓库不存在");

  const ids = [...new Set(postIds.map((s) => s.trim()).filter(Boolean))].map((s) => BigInt(s));
  if (ids.length > 0) {
    const found = await prisma.post.findMany({
      where: { id: { in: ids }, status: "published" },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new GithubAdminError("invalid", "仅可关联已发布文章(存在草稿或不存在的 id)");
    }
  }
  await prisma.$transaction([
    prisma.githubRepoPost.deleteMany({ where: { repoId: id } }),
    ...(ids.length > 0
      ? [prisma.githubRepoPost.createMany({ data: ids.map((postId) => ({ repoId: id, postId })) })]
      : []),
  ]);
  logger.info({ event: "github_repo.posts_set", repoId: id, count: ids.length });
  revalidateProjectPaths(repo.slug);
  return { count: ids.length };
}
