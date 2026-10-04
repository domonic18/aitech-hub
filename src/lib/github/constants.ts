/**
 * GitHub 项目展示常量(二期③/M11):同步节奏、连败阈值、README 缓存口径、
 * 进展动态保留量。枚举类合法值(commit/release、healthy/degraded/error)
 * 应用层 Zod/常量管控,不用 Prisma enum(arch/03 枚举演进条款)。
 */

/** 默认同步间隔(admin 可调 30..1440;白名单 ≤10 仓未配 token 也够 60 req/h) */
export const GITHUB_SYNC_INTERVAL_MIN = 60;

/** 连续失败 ≥3 → status=error(同采集渠道口径) */
export const GITHUB_MAX_CONSECUTIVE_FAILS = 3;

export const GITHUB_STATUS_HEALTHY = "healthy";
export const GITHUB_STATUS_DEGRADED = "degraded";
export const GITHUB_STATUS_ERROR = "error";

export const GITHUB_ACTIVITY_KIND_COMMIT = "commit";
export const GITHUB_ACTIVITY_KIND_RELEASE = "release";

/** 每仓进展动态仅保留最新 50 条(同步轮裁剪) */
export const GITHUB_ACTIVITY_KEEP = 50;

/** 每轮拉取量(拉全为入库上限,超 KEEP 由裁剪兜底;空仓库 404/409 视为空) */
export const GITHUB_COMMITS_PER_SYNC = 30;
export const GITHUB_RELEASES_PER_SYNC = 10;

/** README 解码后截断(外部内容防御;截断处加可见注记,DESIGN-SPEC §6 降级注记纪律) */
export const GITHUB_README_MAX_CHARS = 200_000;
