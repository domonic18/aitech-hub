/**
 * 内部失效端点 token(单源,2026-11-01 批D):`sha256(AUTH_SECRET + ":revalidate")`。
 *
 * 生产方:worker 反向调 `/api/internal/revalidate` 做定向失效(lib/leaderboard/revalidate.ts)。
 * 校验方:`app/api/internal/revalidate/route.ts`。
 * 启动预热:`scripts/warm-isr.mjs` 内联同式(该文件是 .mjs,runner 镜像无 tsx/tsconfig
 * 解析不了 TS 与 `@/` 别名)—— 改本函数必须同步改 `scripts/warm-isr.mjs#revalidateToken`。
 */
import { createHash } from "node:crypto";

export function internalRevalidateToken(secret: string): string {
  return createHash("sha256").update(`${secret}:revalidate`).digest("hex");
}
