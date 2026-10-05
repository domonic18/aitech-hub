/**
 * GitHub REST API 适配器(二期③/M11):本层只做「HTTP 往返 + Zod 校验 + 异常翻译」,
 * 增量/去重/裁剪在 sync 编排层(镜像 douyin 适配器纪律)。
 * 错误分流按状态码:网络/超时/5xx → Unavailable(编排层不计连败);
 * 429 或 403+配额尽 → Unavailable(rateLimited,顺延不计失败——未认证 60 req/h 的典型落点);
 * 401/404/其余 4xx → Upstream(计入连败);2xx 契约漂移 → Upstream ContractDrift(必须响)。
 */
import { z } from "zod";

import { env } from "../env";

import {
  commitItemSchema,
  readmeSchema,
  releaseItemSchema,
  repoMetaSchema,
  type CommitItem,
  type ReadmePayload,
  type ReleaseItem,
  type RepoMeta,
} from "./contract";
import { GithubApiUnavailableError, GithubApiUpstreamError } from "./errors";

const GITHUB_API_BASE = "https://api.github.com";
const TIMEOUT_MS = 30_000;
const API_VERSION = "2022-11-28";

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": API_VERSION,
    "user-agent": "aitech-hub",
  };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
}

/** GET + Zod 校验 + 异常翻译(状态码分流见模块注释) */
async function apiGet<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> {
  let res: Response;
  try {
    res = await fetch(`${GITHUB_API_BASE}${path}`, {
      headers: authHeaders(),
      redirect: "follow", // 仓库改名走 301,跟随拿 canonical 载荷
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new GithubApiUnavailableError(err instanceof Error ? err.message : String(err));
  }
  if (!res.ok) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (res.status === 429 || (res.status === 403 && remaining === "0")) {
      throw new GithubApiUnavailableError(`HTTP ${res.status}(限频)`, true);
    }
    if (res.status >= 500) {
      throw new GithubApiUnavailableError(`HTTP ${res.status}`);
    }
    throw new GithubApiUpstreamError(`HTTP ${res.status}`, path, res.status);
  }
  const body: unknown = await res.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new GithubApiUpstreamError("ContractDrift", parsed.error.message);
  }
  return parsed.data;
}

/** 列表端点逐条容错:脏行计入 dropped 不炸整包(GitHub 载荷变体远多于自控网关) */
async function apiGetList<S extends z.ZodType>(
  path: string,
  itemSchema: S,
): Promise<{ items: z.output<S>[]; dropped: number }> {
  const raw = await apiGet(path, z.array(z.unknown()));
  const items: z.output<S>[] = [];
  let dropped = 0;
  for (const row of raw) {
    const parsed = itemSchema.safeParse(row);
    if (parsed.success) items.push(parsed.data);
    else dropped += 1;
  }
  return { items, dropped };
}

export async function fetchRepoMeta(fullName: string): Promise<RepoMeta> {
  return apiGet(`/repos/${fullName}`, repoMetaSchema);
}

export async function fetchReadme(fullName: string): Promise<ReadmePayload> {
  return apiGet(`/repos/${fullName}/readme`, readmeSchema);
}

export async function fetchCommits(
  fullName: string,
  perPage: number,
): Promise<{ items: CommitItem[]; dropped: number }> {
  return apiGetList(`/repos/${fullName}/commits?per_page=${perPage}`, commitItemSchema);
}

export async function fetchReleases(
  fullName: string,
  perPage: number,
): Promise<{ items: ReleaseItem[]; dropped: number }> {
  return apiGetList(`/repos/${fullName}/releases?per_page=${perPage}`, releaseItemSchema);
}
