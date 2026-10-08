/**
 * GitHub 仓库同步编排(二期③/M11 批①,镜像 ingest-video 纪律):
 * meta 条件更新(字段比对才写,防 updatedAt/sitemap lastmod 每轮空转)→
 * README(base64 解码截断,sha 不变跳写;404/409=无 README/空仓库,已有缓存则清除)→
 * commits/releases 逐条 upsert(去重锚 repo_id+kind+external_id,先查后写 P2002 兜底并发)→
 * 裁剪仅留最新 KEEP 条 → advance 推进调度(lastSyncAt/nextSyncAt/连败/status)。
 * 失败归因:Unavailable(网络/5xx)不计连败只顺延;限频静默顺延;Upstream 计连败,
 * ≥3 → error;失败上抛交 BullMQ failed 事件(后台观测)。
 */
import { isP2002, prisma } from "../db";
import { logger } from "../logger";
import { GITHUB_JOB_SYNC, getQueue, QUEUE_GITHUB } from "../queue";

import { fetchCommits, fetchReadme, fetchReleases, fetchRepoMeta } from "./api";
import type { CommitItem, ReleaseItem } from "./contract";
import {
  GITHUB_ACTIVITY_KEEP,
  GITHUB_ACTIVITY_KIND_COMMIT,
  GITHUB_ACTIVITY_KIND_RELEASE,
  GITHUB_COMMITS_PER_SYNC,
  GITHUB_MAX_CONSECUTIVE_FAILS,
  GITHUB_README_MAX_CHARS,
  GITHUB_RELEASES_PER_SYNC,
  GITHUB_STATUS_DEGRADED,
  GITHUB_STATUS_ERROR,
  GITHUB_STATUS_HEALTHY,
} from "./constants";
import { GithubApiUnavailableError, GithubApiUpstreamError } from "./errors";

/** 单仓单轮同步结果(worker 日志与后台台账观测字段) */
export interface GithubSyncOutcome {
  repoId: number;
  fullName: string;
  /** meta 有实际变化才写(防 updatedAt 空转) */
  metaUpdated: boolean;
  readmeUpdated: boolean;
  fetchedCommits: number;
  fetchedReleases: number;
  insertedCommits: number;
  insertedReleases: number;
  /** (repoId,kind,externalId) 重复跳过 */
  duplicated: number;
  /** 契约脏行丢弃数(逐条容错) */
  droppedItems: number;
  /** 裁剪掉的超 KEEP 条数 */
  pruned: number;
  /** 供应方限频跳过(顺延不计失败) */
  rateLimited: boolean;
  skippedDisabled: boolean;
}

function nextRunAt(intervalMin: number, from: Date): Date {
  return new Date(from.getTime() + intervalMin * 60_000);
}

type ActivityRow = {
  repoId: number;
  kind: string;
  externalId: string;
  title: string;
  url: string | null;
  author: string | null;
  occurredAt: Date;
};

function commitRow(repoId: number, item: CommitItem): ActivityRow {
  const when = item.commit.author?.date ? new Date(item.commit.author.date) : new Date(0);
  return {
    repoId,
    kind: GITHUB_ACTIVITY_KIND_COMMIT,
    externalId: item.sha.slice(0, 100),
    // 标题取提交信息首行(与视频 caption 首行同口径);无日期退 epoch 沉底,确定性排序
    title: item.commit.message.split("\n")[0].trim().slice(0, 500) || "(空提交信息)",
    url: item.html_url,
    author: item.commit.author?.name?.slice(0, 100) ?? null,
    occurredAt: Number.isNaN(when.getTime()) ? new Date(0) : when,
  };
}

function releaseRow(repoId: number, item: ReleaseItem): ActivityRow {
  const when = item.published_at ? new Date(item.published_at) : new Date(0);
  return {
    repoId,
    kind: GITHUB_ACTIVITY_KIND_RELEASE,
    externalId: String(item.id),
    // release 名缺省用 tag(草稿名常空)
    title: (item.name?.trim() || item.tag_name).slice(0, 500),
    url: item.html_url,
    author: item.author?.login?.slice(0, 100) ?? null,
    occurredAt: Number.isNaN(when.getTime()) ? new Date(0) : when,
  };
}

/** 单条进展入库:先查后写,P2002 兜底并发轮次(镜像 ingestItem) */
async function upsertActivity(row: ActivityRow): Promise<"inserted" | "duplicated"> {
  const exists = await prisma.githubRepoActivity.findUnique({
    where: {
      repoId_kind_externalId: {
        repoId: row.repoId,
        kind: row.kind,
        externalId: row.externalId,
      },
    },
    select: { id: true },
  });
  if (exists) return "duplicated";
  try {
    await prisma.githubRepoActivity.create({ data: row, select: { id: true } });
    return "inserted";
  } catch (err) {
    if (isP2002(err)) return "duplicated"; // 并发轮次抢先落库
    throw err;
  }
}

/** 空仓库/无 README 是常态而非故障(404;空仓库 commits 端点为 409) */
function isMissingEndpoint(err: unknown): boolean {
  return err instanceof GithubApiUpstreamError && (err.status === 404 || err.status === 409);
}

/** README 截断(可见注记,DESIGN-SPEC §6 降级注记纪律) */
export function truncateReadme(md: string): string {
  if (md.length <= GITHUB_README_MAX_CHARS) return md;
  return `${md.slice(0, GITHUB_README_MAX_CHARS)}\n\n> README 过长,仅保留前 ${GITHUB_README_MAX_CHARS} 字符,完整内容见仓库。`;
}

/** 单仓同步一轮(worker「sync」job 入口);仓不存在/停用直接空结果 */
export async function syncGithubRepo(repoId: number): Promise<GithubSyncOutcome> {
  const repo = await prisma.githubRepo.findUnique({ where: { id: repoId } });
  const outcome: GithubSyncOutcome = {
    repoId,
    fullName: repo?.fullName ?? "",
    metaUpdated: false,
    readmeUpdated: false,
    fetchedCommits: 0,
    fetchedReleases: 0,
    insertedCommits: 0,
    insertedReleases: 0,
    duplicated: 0,
    droppedItems: 0,
    pruned: 0,
    rateLimited: false,
    skippedDisabled: repo != null && !repo.enabled,
  };
  if (!repo || !repo.enabled) return outcome;

  const now = new Date();
  // 轮终单次 update:调度推进 + meta/readme 条件写入折进同一调用(防 updatedAt 双跳)
  const pending: Record<string, unknown> = {};
  const advance = (data: Record<string, unknown> = {}) =>
    prisma.githubRepo.update({
      where: { id: repo.id },
      data: { lastSyncAt: now, nextSyncAt: nextRunAt(repo.syncIntervalMin, now), ...data },
      select: { id: true },
    });

  try {
    // ── meta(条件写:字段比对,防止无变化轮次 bump updatedAt/sitemap lastmod)──
    const meta = await fetchRepoMeta(repo.fullName);
    const topics = meta.topics;
    if (
      repo.fullName !== meta.full_name ||
      repo.description !== (meta.description ?? null) ||
      repo.stars !== meta.stargazers_count ||
      repo.forks !== meta.forks_count ||
      repo.language !== (meta.language ?? null) ||
      repo.topics.length !== topics.length ||
      repo.topics.some((t, i) => t !== topics[i]) ||
      repo.htmlUrl !== meta.html_url ||
      repo.homepage !== (meta.homepage ?? null) ||
      repo.defaultBranch !== (meta.default_branch || "main")
    ) {
      outcome.metaUpdated = true;
      pending.fullName = meta.full_name; // 改名重定向后 canonical 回写(slug 冻结不受影响)
      pending.description = meta.description ?? null;
      pending.stars = meta.stargazers_count;
      pending.forks = meta.forks_count;
      pending.language = meta.language ?? null;
      pending.topics = topics;
      pending.htmlUrl = meta.html_url;
      pending.homepage = meta.homepage ?? null;
      pending.defaultBranch = meta.default_branch || "main";
    }

    // ── README(sha 不变跳写;404/409 清缓存——README 被删)──
    try {
      const readme = await fetchReadme(repo.fullName);
      if (readme.sha !== repo.readmeSha) {
        const decoded = Buffer.from(readme.content, "base64").toString("utf8");
        pending.readmeMd = truncateReadme(decoded);
        pending.readmeSha = readme.sha;
        pending.readmeFetchedAt = now;
        outcome.readmeUpdated = true;
      }
    } catch (err) {
      if (!isMissingEndpoint(err)) throw err;
      if (repo.readmeSha != null || repo.readmeMd != null) {
        pending.readmeMd = null;
        pending.readmeSha = null;
        pending.readmeFetchedAt = now;
        outcome.readmeUpdated = true;
      }
    }

    // ── 进展动态(commits/releases;空仓库 409/无 releases 空数组都视为空)──
    let commits: Awaited<ReturnType<typeof fetchCommits>> = { items: [], dropped: 0 };
    try {
      commits = await fetchCommits(repo.fullName, GITHUB_COMMITS_PER_SYNC);
    } catch (err) {
      if (!isMissingEndpoint(err)) throw err; // 空仓库 commits 端点 409/404
    }
    outcome.fetchedCommits = commits.items.length;
    outcome.droppedItems += commits.dropped;
    for (const item of commits.items) {
      const verdict = await upsertActivity(commitRow(repo.id, item));
      outcome[verdict === "inserted" ? "insertedCommits" : "duplicated"] += 1;
    }

    let releases: Awaited<ReturnType<typeof fetchReleases>> = { items: [], dropped: 0 };
    try {
      releases = await fetchReleases(repo.fullName, GITHUB_RELEASES_PER_SYNC);
    } catch (err) {
      if (!isMissingEndpoint(err)) throw err;
    }
    outcome.fetchedReleases = releases.items.length;
    outcome.droppedItems += releases.dropped;
    for (const item of releases.items) {
      const verdict = await upsertActivity(releaseRow(repo.id, item));
      outcome[verdict === "inserted" ? "insertedReleases" : "duplicated"] += 1;
    }

    // ── 裁剪:仅留最新 KEEP 条(occurredAt 平手按 id 新者留)──
    const keep = await prisma.githubRepoActivity.findMany({
      where: { repoId: repo.id },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: GITHUB_ACTIVITY_KEEP,
      select: { id: true },
    });
    const removed = await prisma.githubRepoActivity.deleteMany({
      where: { repoId: repo.id, id: { notIn: keep.map((k) => k.id) } },
    });
    outcome.pruned = removed.count;

    await advance({
      ...pending,
      consecutiveFails: 0,
      lastError: null,
      status: GITHUB_STATUS_HEALTHY,
    });
    return outcome;
  } catch (err) {
    if (err instanceof GithubApiUnavailableError) {
      if (err.rateLimited) {
        // 供应方限频:非故障,静默顺延不计失败(未认证 60 req/h 常态)
        outcome.rateLimited = true;
        await advance();
        logger.warn({
          event: "github.sync.rate_limited",
          repoId: repo.id,
          fullName: repo.fullName,
        });
        return outcome;
      }
      // 基础设施故障 ≠ 仓库同步失败:顺延本轮,连续失败不累计(告警走 BullMQ failed)
      await advance();
      logger.warn({ event: "github.sync.unavailable", repoId: repo.id, error: err.message });
      throw err;
    }
    const fails =
      err instanceof GithubApiUpstreamError ? repo.consecutiveFails + 1 : repo.consecutiveFails;
    const message = err instanceof Error ? err.message : String(err);
    await advance({
      ...pending, // 已落盘的局部成果(meta/readme)照写,不因后续失败丢弃
      consecutiveFails: fails,
      lastError: message.slice(0, 500),
      status: fails >= GITHUB_MAX_CONSECUTIVE_FAILS ? GITHUB_STATUS_ERROR : GITHUB_STATUS_DEGRADED,
    });
    throw err;
  }
}

/** worker「tick」入口(每 5min):扫到期白名单仓逐仓入队,失败隔离在单仓 job */
export async function syncDueRepos(): Promise<{ due: number }> {
  const due = await prisma.githubRepo.findMany({
    where: {
      enabled: true,
      OR: [{ nextSyncAt: null }, { nextSyncAt: { lte: new Date() } }],
    },
    select: { id: true, nextSyncAt: true },
    orderBy: { id: "asc" },
  });
  const queue = getQueue(QUEUE_GITHUB);
  for (const repo of due) {
    // jobId 锚定到期时刻:同仓同轮重复入队被 BullMQ 幂等挡掉(只用连字符,禁冒号)
    await queue.add(
      GITHUB_JOB_SYNC,
      { repoId: repo.id },
      {
        jobId: `github-sync-${repo.id}-${repo.nextSyncAt?.getTime() ?? 0}`,
        removeOnComplete: 200,
        removeOnFail: 200,
      },
    );
  }
  return { due: due.length };
}
