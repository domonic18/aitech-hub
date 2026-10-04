import { beforeEach, describe, expect, it, vi } from "vitest";

// api 层直连 env(AUTH_SECRET 等必填),hoisted 先补测试环境变量
vi.hoisted(() => {
  process.env.AUTH_SECRET ??= "test-secret-0123456789abcdef";
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5434/test";
  process.env.REDIS_URL ??= "redis://localhost:6380/0";
  process.env.GITHUB_TOKEN = "test-token";
});

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { fetchCommits, fetchReadme, fetchReleases, fetchRepoMeta } from "./api";
import { GithubApiUnavailableError, GithubApiUpstreamError } from "./errors";

function res(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers,
  });
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("apiGet(状态码分流)", () => {
  it("2xx 合法载荷直接解析;带 Bearer token 与 API 版本头", async () => {
    fetchMock.mockResolvedValueOnce(
      res(200, { full_name: "o/r", html_url: "https://github.com/o/r" }),
    );
    const meta = await fetchRepoMeta("o/r");
    expect(meta.full_name).toBe("o/r");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-token");
    expect(headers["x-github-api-version"]).toBe("2022-11-28");
    expect((fetchMock.mock.calls[0][0] as string).startsWith("https://api.github.com/repos/")).toBe(
      true,
    );
  });

  it("404/401 → Upstream 且携带 status(repos-admin 按 404 细分 not_found)", async () => {
    fetchMock.mockResolvedValueOnce(res(404, { message: "Not Found" }));
    const err404 = await fetchRepoMeta("o/gone").catch((e: unknown) => e);
    expect(err404).toBeInstanceOf(GithubApiUpstreamError);
    expect((err404 as GithubApiUpstreamError).status).toBe(404);

    fetchMock.mockResolvedValueOnce(res(401, { message: "Bad credentials" }));
    const err401 = await fetchRepoMeta("o/r").catch((e: unknown) => e);
    expect((err401 as GithubApiUpstreamError).status).toBe(401);
  });

  it("429 与 403+配额尽 → Unavailable(rateLimited=true);403 无配额头 → 普通 Unavailable", async () => {
    fetchMock.mockResolvedValueOnce(res(429, { message: "rate limited" }));
    const e429 = await fetchRepoMeta("o/r").catch((e: unknown) => e);
    expect(e429).toBeInstanceOf(GithubApiUnavailableError);
    expect((e429 as GithubApiUnavailableError).rateLimited).toBe(true);

    fetchMock.mockResolvedValueOnce(
      res(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0" }),
    );
    const e403 = await fetchRepoMeta("o/r").catch((e: unknown) => e);
    expect((e403 as GithubApiUnavailableError).rateLimited).toBe(true);

    // 403 无配额头 = token 权限问题(非限频)→ Upstream 计连败
    fetchMock.mockResolvedValueOnce(res(403, { message: "forbidden" }));
    const e403b = await fetchRepoMeta("o/r").catch((e: unknown) => e);
    expect(e403b).toBeInstanceOf(GithubApiUpstreamError);
    expect((e403b as GithubApiUpstreamError).status).toBe(403);
  });

  it("5xx 与网络层故障 → Unavailable(不计连败);2xx 契约漂移 → Upstream ContractDrift", async () => {
    fetchMock.mockResolvedValueOnce(res(502, null));
    const e502 = await fetchRepoMeta("o/r").catch((e: unknown) => e);
    expect(e502).toBeInstanceOf(GithubApiUnavailableError);
    expect((e502 as GithubApiUnavailableError).rateLimited).toBe(false);

    fetchMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    const enet = await fetchRepoMeta("o/r").catch((e: unknown) => e);
    expect(enet).toBeInstanceOf(GithubApiUnavailableError);

    fetchMock.mockResolvedValueOnce(res(200, { unexpected: true }));
    const edrift = await fetchRepoMeta("o/r").catch((e: unknown) => e);
    expect(edrift).toBeInstanceOf(GithubApiUpstreamError);
    expect((edrift as GithubApiUpstreamError).kind).toBe("ContractDrift");
  });
});

describe("列表端点逐条容错", () => {
  it("commits:合法行保留、脏行计入 dropped", async () => {
    fetchMock.mockResolvedValueOnce(
      res(200, [
        {
          sha: "a".repeat(40),
          html_url: "https://github.com/o/r/commit/1",
          commit: {
            message: "feat: a",
            author: { name: "诸葛东明", date: "2026-10-04T00:00:00Z" },
          },
        },
        { garbage: true },
        {
          sha: "b".repeat(40),
          html_url: "https://github.com/o/r/commit/2",
          commit: { message: "fix: b" },
        },
      ]),
    );
    const { items, dropped } = await fetchCommits("o/r", 30);
    expect(items).toHaveLength(2);
    expect(dropped).toBe(1);
    expect(items[0]?.commit.author?.name).toBe("诸葛东明");
  });

  it("releases:空列表透传为空(无 release 是常态)", async () => {
    fetchMock.mockResolvedValueOnce(res(200, []));
    const { items, dropped } = await fetchReleases("o/r", 10);
    expect(items).toEqual([]);
    expect(dropped).toBe(0);
  });

  it("readme:正常载荷透传", async () => {
    fetchMock.mockResolvedValueOnce(res(200, { content: "SGVsbG8=", sha: "s1", size: 5 }));
    const readme = await fetchReadme("o/r");
    expect(readme.sha).toBe("s1");
  });
});
