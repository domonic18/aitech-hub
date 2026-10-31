/**
 * 榜单页 on-demand 缓存失效(M63 后续,2026-10-31)。
 *
 * 问题:榜单采集跑在 **worker 进程**,没有 Next 请求上下文,`revalidatePath` 调不了;
 * `/leaderboards/` 又是 ISR 3600 的预渲染产物,于是采完只能干等窗口——窗口若撞在
 * 采集完成之前(实测生产 18:56 构建 / 19:15 采集),页面会拿旧数据再生一次并把
 * mtime 推到下一个小时,对外表现为「数据已经是新的,页面还是昨天的」。
 *
 * 解法:采集成功后由 worker 反向调 web 的内部失效端点(`/api/internal/revalidate`,
 * 与 entrypoint 预热同一个,M63 同批扩展了 `paths` 定向失效)。只失效
 * `/leaderboards/` 一条,不动全站缓存。
 *
 * 纪律:失效失败**绝不**抛给采集——数据已落库,页面最迟由 ISR 窗口兜底;
 * 失败只记 warn 供排查。
 */
import { createHash } from "node:crypto";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/** 需要失效的路径(改这里必须同步 `api/internal/revalidate` 的 PATH_ALLOWLIST) */
export const LEADERBOARD_CACHE_PATHS = ["/leaderboards/"] as const;

const REVALIDATE_TIMEOUT_MS = 10_000;

/** 内部端点 token(AUTH_SECRET 派生,与 entrypoint.sh 同式) */
export function internalRevalidateToken(secret: string): string {
  return createHash("sha256").update(`${secret}:revalidate`).digest("hex");
}

/** 触发一次定向失效;成功 true,失败 false(不抛) */
export async function revalidateLeaderboardPage(): Promise<boolean> {
  const base = env.WEB_INTERNAL_URL.replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/api/internal/revalidate/`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": internalRevalidateToken(env.AUTH_SECRET),
      },
      body: JSON.stringify({ paths: [...LEADERBOARD_CACHE_PATHS] }),
      signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
    logger.info({ event: "leaderboard.revalidated", paths: LEADERBOARD_CACHE_PATHS });
    return true;
  } catch (e) {
    logger.warn({
      event: "leaderboard.revalidate_failed",
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}
