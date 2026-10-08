import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, queueMock } = vi.hoisted(() => ({
  prismaMock: {
    githubRepo: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    githubRepoActivity: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  queueMock: { add: vi.fn() },
}));

vi.mock("../db", () => ({
  prisma: prismaMock,
  isP2002: (e: unknown) =>
    typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002",
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../queue", () => ({
  GITHUB_JOB_SYNC: "sync",
  QUEUE_GITHUB: "github",
  getQueue: () => queueMock,
}));
vi.mock("./api", () => ({
  fetchRepoMeta: vi.fn(),
  fetchReadme: vi.fn(),
  fetchCommits: vi.fn(),
  fetchReleases: vi.fn(),
}));

import { fetchCommits, fetchReadme, fetchReleases, fetchRepoMeta } from "./api";
import { GithubApiUnavailableError, GithubApiUpstreamError } from "./errors";
import { syncDueRepos, syncGithubRepo, truncateReadme } from "./sync";

const META = {
  full_name: "domonic18/demo",
  description: "demo repo",
  stargazers_count: 12,
  forks_count: 2,
  language: "TypeScript",
  topics: ["ai"],
  html_url: "https://github.com/domonic18/demo",
  homepage: null,
  default_branch: "main",
  pushed_at: "2026-10-04T00:00:00Z",
};

const REPO_ROW = {
  id: 1,
  fullName: "domonic18/demo",
  description: "demo repo",
  stars: 12,
  forks: 2,
  language: "TypeScript",
  topics: ["ai"],
  htmlUrl: "https://github.com/domonic18/demo",
  homepage: null,
  defaultBranch: "main",
  readmeMd: null,
  readmeSha: null,
  readmeFetchedAt: null,
  enabled: true,
  syncIntervalMin: 60,
  consecutiveFails: 0,
};

/** 同步轮全绿默认桩:meta 无变化 + readme sha 相同 + 1 新提交 + 1 新 release + 空裁剪 */
function stubHappyRound(): void {
  vi.mocked(fetchRepoMeta).mockResolvedValue(META);
  vi.mocked(fetchReadme).mockResolvedValue({ content: "SGVsbG8=", sha: "sha-1", size: 5 });
  vi.mocked(fetchCommits).mockResolvedValue({
    items: [
      {
        sha: "c1",
        html_url: "u1",
        commit: { message: "feat: a", author: { name: "Z", date: "2026-10-04T01:00:00Z" } },
      },
    ],
    dropped: 0,
  });
  vi.mocked(fetchReleases).mockResolvedValue({
    items: [
      {
        id: 9,
        name: "v1",
        tag_name: "v1",
        html_url: "u2",
        published_at: null,
        draft: false,
        prerelease: false,
      },
    ],
    dropped: 0,
  });
  prismaMock.githubRepoActivity.findUnique.mockResolvedValue(null);
  prismaMock.githubRepoActivity.create.mockResolvedValue({ id: BigInt(1) });
  prismaMock.githubRepoActivity.findMany.mockResolvedValue([{ id: BigInt(1) }]);
  prismaMock.githubRepoActivity.deleteMany.mockResolvedValue({ count: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.githubRepo.update.mockResolvedValue({ id: 1 });
  prismaMock.githubRepo.findUnique.mockResolvedValue({ ...REPO_ROW });
});

describe("syncGithubRepo(outcome 计数与条件写)", () => {
  it("全绿轮:meta 变化才写、readme sha 变化写缓存、动态计数与裁剪、终态 healthy", async () => {
    stubHappyRound();
    prismaMock.githubRepo.findUnique.mockResolvedValue({ ...REPO_ROW, stars: 1, readmeSha: "old" });
    vi.mocked(fetchReadme).mockResolvedValue({
      content: Buffer.from("# Demo").toString("base64"),
      sha: "sha-1",
      size: 6,
    });

    const outcome = await syncGithubRepo(1);

    expect(outcome).toMatchObject({
      fullName: "domonic18/demo",
      metaUpdated: true,
      readmeUpdated: true,
      fetchedCommits: 1,
      fetchedReleases: 1,
      insertedCommits: 1,
      insertedReleases: 1,
      duplicated: 0,
      pruned: 0,
    });
    const data = prismaMock.githubRepo.update.mock.calls.at(-1)![0].data as Record<string, unknown>;
    expect(data.stars).toBe(12);
    expect(data.readmeMd).toBe("# Demo");
    expect(data.readmeSha).toBe("sha-1");
    expect(data.consecutiveFails).toBe(0);
    expect(data.status).toBe("healthy");
    expect(data.lastSyncAt).toBeInstanceOf(Date);
    expect(data.nextSyncAt).toBeInstanceOf(Date);
  });

  it("meta 与 readme 均无变化 → 不写对应字段(防 updatedAt/sitemap lastmod 空转)", async () => {
    stubHappyRound();
    prismaMock.githubRepo.findUnique.mockResolvedValue({
      ...REPO_ROW,
      readmeSha: "sha-1",
    });

    const outcome = await syncGithubRepo(1);
    expect(outcome.metaUpdated).toBe(false);
    expect(outcome.readmeUpdated).toBe(false);
    const data = prismaMock.githubRepo.update.mock.calls.at(-1)![0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty("stars");
    expect(data).not.toHaveProperty("readmeMd");
    expect(data.status).toBe("healthy");
  });

  it("README 404(被删)→ 清缓存;空仓库 commits 409 → 视为空不失败", async () => {
    stubHappyRound();
    prismaMock.githubRepo.findUnique.mockResolvedValue({
      ...REPO_ROW,
      readmeMd: "# old",
      readmeSha: "old-sha",
    });
    vi.mocked(fetchReadme).mockRejectedValue(
      new GithubApiUpstreamError("HTTP 404", "/readme", 404),
    );
    vi.mocked(fetchCommits).mockRejectedValue(
      new GithubApiUpstreamError("HTTP 409", "/commits", 409),
    );
    vi.mocked(fetchReleases).mockResolvedValue({ items: [], dropped: 0 });

    const outcome = await syncGithubRepo(1);
    expect(outcome.readmeUpdated).toBe(true);
    expect(outcome.fetchedCommits).toBe(0);
    const data = prismaMock.githubRepo.update.mock.calls.at(-1)![0].data as Record<string, unknown>;
    expect(data.readmeMd).toBeNull();
    expect(data.status).toBe("healthy");
  });

  it("activity P2002 并发抢占 → duplicated;超 KEEP 裁剪计入 pruned", async () => {
    stubHappyRound();
    prismaMock.githubRepoActivity.findUnique.mockResolvedValue({ id: BigInt(5) }); // 提交已存在
    prismaMock.githubRepoActivity.create.mockRejectedValue({ code: "P2002" }); // release 并发抢
    prismaMock.githubRepoActivity.deleteMany.mockResolvedValue({ count: 7 });

    const outcome = await syncGithubRepo(1);
    expect(outcome.insertedCommits).toBe(0);
    expect(outcome.duplicated).toBe(2);
    expect(outcome.pruned).toBe(7);
    expect(prismaMock.githubRepoActivity.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ repoId: 1, id: { notIn: [BigInt(1)] } }),
      }),
    );
  });

  it("限频(Unavailable+rateLimited)→ 静默顺延不计连败不抛错", async () => {
    stubHappyRound();
    vi.mocked(fetchRepoMeta).mockRejectedValue(
      new GithubApiUnavailableError("HTTP 403(限频)", true),
    );
    prismaMock.githubRepo.findUnique.mockResolvedValue({ ...REPO_ROW, consecutiveFails: 2 });

    const outcome = await syncGithubRepo(1);
    expect(outcome.rateLimited).toBe(true);
    const data = prismaMock.githubRepo.update.mock.calls.at(-1)![0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty("consecutiveFails");
    expect(data).not.toHaveProperty("lastError");
  });

  it("Unavailable(网络)→ 只顺延计连败归零不累计,错误上抛(BullMQ failed 观测)", async () => {
    stubHappyRound();
    vi.mocked(fetchRepoMeta).mockRejectedValue(new GithubApiUnavailableError("timeout"));
    prismaMock.githubRepo.findUnique.mockResolvedValue({ ...REPO_ROW, consecutiveFails: 2 });

    await expect(syncGithubRepo(1)).rejects.toBeInstanceOf(GithubApiUnavailableError);
    const data = prismaMock.githubRepo.update.mock.calls.at(-1)![0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty("consecutiveFails");
  });

  it("Upstream → 连败+1 降级;达阈值置 error", async () => {
    stubHappyRound();
    vi.mocked(fetchRepoMeta).mockRejectedValue(new GithubApiUpstreamError("HTTP 401", "p", 401));
    prismaMock.githubRepo.findUnique.mockResolvedValue({ ...REPO_ROW, consecutiveFails: 2 });

    await expect(syncGithubRepo(1)).rejects.toBeInstanceOf(GithubApiUpstreamError);
    const data = prismaMock.githubRepo.update.mock.calls.at(-1)![0].data as Record<string, unknown>;
    expect(data.consecutiveFails).toBe(3);
    expect(data.status).toBe("error");
    expect(String(data.lastError)).toContain("401");
  });

  it("仓不存在/停用 → 空结果零写库", async () => {
    prismaMock.githubRepo.findUnique.mockResolvedValue(null);
    const none = await syncGithubRepo(99);
    expect(none.skippedDisabled).toBe(false);
    prismaMock.githubRepo.findUnique.mockResolvedValue({ ...REPO_ROW, enabled: false });
    const disabled = await syncGithubRepo(1);
    expect(disabled.skippedDisabled).toBe(true);
    expect(prismaMock.githubRepo.update).not.toHaveBeenCalled();
  });
});

describe("truncateReadme(超长截断加可见注记)", () => {
  it("未超长原样;超长截断并附 blockquote 注记", () => {
    expect(truncateReadme("short")).toBe("short");
    const long = "x".repeat(200_001);
    const cut = truncateReadme(long);
    expect(cut.startsWith("x".repeat(200_000))).toBe(true);
    expect(cut).toContain("README 过长");
  });
});

describe("syncDueRepos(tick 扇出)", () => {
  it("到期/未登记调度行逐仓入队,jobId 锚定到期时刻(nextSyncAt null → 0)", async () => {
    prismaMock.githubRepo.findMany.mockResolvedValue([
      { id: 1, nextSyncAt: new Date(1_000) },
      { id: 2, nextSyncAt: null },
    ]);
    const { due } = await syncDueRepos();
    expect(due).toBe(2);
    expect(queueMock.add).toHaveBeenCalledTimes(2);
    expect(queueMock.add).toHaveBeenCalledWith(
      "sync",
      { repoId: 1 },
      expect.objectContaining({ jobId: "github-sync-1-1000" }),
    );
    expect(queueMock.add).toHaveBeenCalledWith(
      "sync",
      { repoId: 2 },
      expect.objectContaining({ jobId: "github-sync-2-0" }),
    );
  });
});
