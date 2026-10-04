/**
 * GitHub 仓库台账管理单测(M11 批②):db/queue/logger/GitHub 适配器/revalidate
 * 全打桩,验登记存在性三判(404 拒/降级入库/canonical 大小写)、slug 派生冲突
 * 后缀、两步武装删除、手动同步 jobId 前缀、配套文章 published-only 校验与
 * 整体替换事务、上下架失效编排。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  githubRepo: {
    findUnique: vi.fn<(args?: unknown) => Promise<unknown>>(),
    findMany: vi.fn<(args?: unknown) => Promise<unknown>>(async () => []),
    create: vi.fn<(args?: unknown) => Promise<unknown>>(),
    update: vi.fn<(args?: unknown) => Promise<unknown>>(),
    delete: vi.fn<(args?: unknown) => Promise<unknown>>(),
    count: vi.fn<(args?: unknown) => Promise<number>>(async () => 0),
  },
  githubRepoPost: {
    findMany: vi.fn<(args?: unknown) => Promise<unknown>>(async () => []),
    deleteMany: vi.fn<(args?: unknown) => Promise<unknown>>(),
    createMany: vi.fn<(args?: unknown) => Promise<unknown>>(),
  },
  post: { findMany: vi.fn<(args?: unknown) => Promise<unknown>>(async () => []) },
  $transaction: vi.fn<(ops: unknown[]) => Promise<unknown>>(async (ops) => ops),
}));
vi.mock("../db", () => ({
  prisma: prismaMock,
  isP2002: (e: unknown) =>
    typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002",
}));

vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const queueMock = vi.hoisted(() => ({ add: vi.fn(async () => undefined) }));
vi.mock("../queue", () => ({
  GITHUB_JOB_SYNC: "sync",
  QUEUE_GITHUB: "github",
  getQueue: () => queueMock,
}));

vi.mock("./api", () => ({ fetchRepoMeta: vi.fn() }));
vi.mock("./revalidate", () => ({ revalidateProjectPaths: vi.fn() }));

import { fetchRepoMeta } from "./api";
import { revalidateProjectPaths } from "./revalidate";
import { GithubApiUnavailableError, GithubApiUpstreamError } from "./errors";
import {
  createRepo,
  deleteRepo,
  listRepoPostOptions,
  setRepoPosts,
  setRepoStatus,
  triggerRepoSync,
  updateRepo,
} from "./repos-admin";

const META = {
  full_name: "domonic18/My_Repo",
  description: "demo",
  stargazers_count: 7,
  forks_count: 1,
  language: "TypeScript",
  topics: ["ai"],
  html_url: "https://github.com/domonic18/My_Repo",
  homepage: null,
  default_branch: "main",
  pushed_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.githubRepo.create.mockResolvedValue({ id: 1 });
  prismaMock.githubRepo.update.mockResolvedValue({ id: 1 });
});

describe("createRepo(登记)", () => {
  it("meta 命中:fullName 用 GitHub canonical 大小写,slug 由 name 派生(. _ 归 -)", async () => {
    vi.mocked(fetchRepoMeta).mockResolvedValue(META);
    await createRepo({
      fullName: "domonic18/my_repo",
      syncIntervalMin: 30,
      remark: null,
    });
    expect(prismaMock.githubRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fullName: "domonic18/My_Repo",
          slug: "my-repo",
          stars: 7,
          htmlUrl: "https://github.com/domonic18/My_Repo",
        }),
      }),
    );
  });

  it("GitHub 404 → not_found 拒绝", async () => {
    vi.mocked(fetchRepoMeta).mockRejectedValue(new GithubApiUpstreamError("HTTP 404", "/p", 404));
    await expect(createRepo({ fullName: "domonic18/nope", remark: null })).rejects.toMatchObject({
      code: "not_found",
    });
    expect(prismaMock.githubRepo.create).not.toHaveBeenCalled();
  });

  it("网络不可达(Unavailable)→ 降级入库,htmlUrl 兜底构造", async () => {
    vi.mocked(fetchRepoMeta).mockRejectedValue(new GithubApiUnavailableError("timeout"));
    await createRepo({ fullName: "domonic18/Demo.v2", remark: null });
    expect(prismaMock.githubRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fullName: "domonic18/Demo.v2",
          slug: "demo-v2",
          stars: 0,
          htmlUrl: "https://github.com/domonic18/Demo.v2",
        }),
      }),
    );
  });

  it("slug 基形被占 → 取 -2 后缀;P2002(并发)→ duplicate", async () => {
    vi.mocked(fetchRepoMeta).mockResolvedValue(META);
    prismaMock.githubRepo.findMany.mockResolvedValue([{ slug: "my-repo" }]);
    await createRepo({ fullName: "domonic18/My_Repo", remark: null });
    expect(prismaMock.githubRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ slug: "my-repo-2" }) }),
    );

    prismaMock.githubRepo.create.mockRejectedValue({ code: "P2002" });
    await expect(createRepo({ fullName: "domonic18/My_Repo", remark: null })).rejects.toMatchObject(
      { code: "duplicate" },
    );
  });
});

describe("编辑/启停/删除", () => {
  it("updateRepo 不存在 → not_found;成功后失效列表与详情", async () => {
    prismaMock.githubRepo.findUnique.mockResolvedValueOnce(null);
    await expect(
      updateRepo(1, { syncIntervalMin: 60, sortOrder: 0, remark: null }),
    ).rejects.toMatchObject({ code: "not_found" });

    prismaMock.githubRepo.findUnique.mockResolvedValueOnce({ id: 1, slug: "demo" });
    await updateRepo(1, { syncIntervalMin: 60, sortOrder: 3, remark: null });
    expect(prismaMock.githubRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { syncIntervalMin: 60, sortOrder: 3, remark: null } }),
    );
    expect(revalidateProjectPaths).toHaveBeenCalledWith("demo");
  });

  it("setRepoStatus:display 变更才失效;enabled 单独切换不失效", async () => {
    prismaMock.githubRepo.findUnique.mockResolvedValue({ id: 1, slug: "demo" });
    await setRepoStatus(1, { enabled: false });
    expect(revalidateProjectPaths).not.toHaveBeenCalled();
    await setRepoStatus(1, { display: false });
    expect(revalidateProjectPaths).toHaveBeenCalledWith("demo");
  });

  it("deleteRepo 两步武装:启用中 409;停用后物理删,原上架则失效", async () => {
    prismaMock.githubRepo.findUnique.mockResolvedValue({
      id: 1,
      enabled: true,
      display: true,
      fullName: "o/r",
      slug: "r",
    });
    await expect(deleteRepo(1)).rejects.toMatchObject({ code: "enabled" });
    expect(prismaMock.githubRepo.delete).not.toHaveBeenCalled();

    prismaMock.githubRepo.findUnique.mockResolvedValue({
      id: 1,
      enabled: false,
      display: true,
      fullName: "o/r",
      slug: "r",
    });
    await deleteRepo(1);
    expect(prismaMock.githubRepo.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(revalidateProjectPaths).toHaveBeenCalledWith("r");
  });
});

describe("triggerRepoSync / 配套文章", () => {
  it("手动同步:停用拒绝;入队 jobId 前缀 github-sync-{id}-manual-", async () => {
    prismaMock.githubRepo.findUnique.mockResolvedValue({ id: 1, enabled: false, fullName: "o/r" });
    await expect(triggerRepoSync(1)).rejects.toMatchObject({ code: "disabled" });

    prismaMock.githubRepo.findUnique.mockResolvedValue({ id: 1, enabled: true, fullName: "o/r" });
    await expect(triggerRepoSync(1)).resolves.toEqual({ enqueued: true });
    expect(queueMock.add).toHaveBeenCalledWith(
      "sync",
      { repoId: 1 },
      expect.objectContaining({ jobId: expect.stringMatching(/^github-sync-1-manual-/) }),
    );
  });

  it("关联选项:post id 字符串化 + linked 标记;仓不存在 → not_found", async () => {
    prismaMock.githubRepo.findUnique.mockResolvedValue(null);
    await expect(listRepoPostOptions(1)).rejects.toMatchObject({ code: "not_found" });

    prismaMock.githubRepo.findUnique.mockResolvedValue({ id: 1 });
    prismaMock.post.findMany.mockResolvedValue([
      { id: BigInt(1), title: "A" },
      { id: BigInt(2), title: "B" },
    ]);
    prismaMock.githubRepoPost.findMany.mockResolvedValue([{ postId: BigInt(1) }]);
    await expect(listRepoPostOptions(1)).resolves.toEqual([
      { id: "1", title: "A", linked: true },
      { id: "2", title: "B", linked: false },
    ]);
  });

  it("setRepoPosts:草稿/缺失 id → invalid 不写库;合法 → 事务整体替换并失效", async () => {
    prismaMock.githubRepo.findUnique.mockResolvedValue({ id: 1, slug: "demo" });
    prismaMock.post.findMany.mockResolvedValue([{ id: BigInt(1) }]);
    await expect(setRepoPosts(1, ["1", "2"])).rejects.toMatchObject({ code: "invalid" });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();

    prismaMock.post.findMany.mockResolvedValue([{ id: BigInt(1) }, { id: BigInt(2) }]);
    await setRepoPosts(1, ["1", "1", "2"]);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    const ops = prismaMock.$transaction.mock.calls[0][0] as unknown[];
    expect(ops).toHaveLength(2);
    expect(revalidateProjectPaths).toHaveBeenCalledWith("demo");
  });

  it("setRepoPosts 空数组 → 仅删除(解除全部关联)", async () => {
    prismaMock.githubRepo.findUnique.mockResolvedValue({ id: 1, slug: "demo" });
    await setRepoPosts(1, []);
    const ops = prismaMock.$transaction.mock.calls[0][0] as unknown[];
    expect(ops).toHaveLength(1);
  });
});
