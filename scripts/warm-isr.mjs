#!/usr/bin/env node
/**
 * ISR 预热执行器(docker/app/entrypoint.sh 起服后后台调用;issue #203)。
 *
 * 为什么需要:镜像构建期没有 DB,静态页经 prerenderSafe 降级成空产物;ISR 窗口内
 * 不会自动再生,用户会看到空壳 hanging 满一个 revalidate 周期(2026-10-03 实测
 * feed/sitemap 空壳挂 1h)。所以起服后要主动打一遍:
 *   1. 轮询 /api/health/ 就绪 —— 不能用固定 sleep(server 绑定可能晚于 sleep,
 *      请求落空且被吞);
 *   2. POST /api/internal/revalidate/ 全站失效(AUTH_SECRET 派生 token);
 *   3. 逐路径双 fetch:首次触发再生、第二次取新鲜产物入缓存。
 *
 * 路由清单与 src/lib/seo/routes.ts 共用 src/lib/seo/warm-routes.json(单一来源);
 * 本文件是 .mjs 而非 .ts:runner 镜像不带 tsconfig,tsx 解析不了 `@/` 别名。
 * 失败一律不阻塞启动 —— 预热是优化,不是启动前置条件。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const ROUTES = JSON.parse(
  readFileSync(new URL("../src/lib/seo/warm-routes.json", import.meta.url), "utf8"),
);

const BASE = `http://127.0.0.1:${process.env.PORT || 3000}`;
const HEALTH_POLLS = 30;
const POLL_INTERVAL_MS = 2000;
const REVALIDATE_RETRIES = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitHealthy() {
  for (let i = 0; i < HEALTH_POLLS; i += 1) {
    const res = await fetch(`${BASE}/api/health/`).catch(() => null);
    if (res?.ok) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

/** token 单源:`src/lib/http/internal-token.ts`(.mjs 在 runner 镜像里解析不了 TS,故内联同式;改一处必须同步另一处) */
function revalidateToken() {
  return createHash("sha256").update(`${process.env.AUTH_SECRET}:revalidate`).digest("hex");
}

async function invalidateAll() {
  const token = revalidateToken();
  for (let i = 0; i < REVALIDATE_RETRIES; i += 1) {
    const res = await fetch(`${BASE}/api/internal/revalidate/`, {
      method: "POST",
      headers: { "x-internal-token": token },
    }).catch(() => null);
    if (res?.ok) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

async function warmAll() {
  for (const path of ROUTES) {
    await fetch(`${BASE}${path}`).catch(() => undefined);
    await sleep(1000);
    await fetch(`${BASE}${path}`).catch(() => undefined);
  }
}

if (!(await waitHealthy())) {
  console.error("[warm-isr] health check timed out, skip warmup");
} else if (!(await invalidateAll())) {
  console.error("[warm-isr] revalidate endpoint unreachable, skip warmup");
} else {
  await warmAll();
  console.log(`[warm-isr] warmed ${ROUTES.length} routes`);
}
