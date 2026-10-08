/**
 * GitHub 项目展示错误族(二期③/M11):
 * - GithubApiUnavailableError:网络/超时/5xx/限频(429 或 403+配额尽)——基础设施
 *   故障,编排层不计连败只顺延(rateLimited=true 时静默顺延,镜像 ingest RateLimitedError);
 * - GithubApiUpstreamError:401/404/契约漂移——上游问题,计入连败;
 * - GithubAdminError:admin 服务层领域错误(code 并集,路由层映射 HTTP 状态,
 *   镜像 BloggerAdminError)。
 */

export class GithubApiUnavailableError extends Error {
  constructor(
    detail: string,
    /** 供应方限频标记:顺延重排但不计失败、不告警(护栏非错误) */
    readonly rateLimited = false,
  ) {
    super(`GitHub API 不可达: ${detail}`);
    this.name = "GithubApiUnavailableError";
  }
}

export class GithubApiUpstreamError extends Error {
  constructor(
    readonly kind: string,
    detail: string,
    /** HTTP 状态码(网络层/契约漂移无;repos-admin 按 404/401 细分提示) */
    readonly status?: number,
  ) {
    super(`${kind}: ${detail}`);
    this.name = "GithubApiUpstreamError";
  }
}

export type GithubAdminErrorCode = "not_found" | "duplicate" | "enabled" | "disabled" | "invalid";

export class GithubAdminError extends Error {
  constructor(
    readonly code: GithubAdminErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GithubAdminError";
  }
}
