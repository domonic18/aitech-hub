import { defineConfig } from "@playwright/test";

/**
 * E2E 冒烟(standard/01-testing §4,5 条以内):本地全栈验收,前置条件——
 *   1. `npm run build`(用例打的是构建产物,CI app job 不构建,E2E 在本地/发布前跑)
 *   2. pg(5434)/ redis(6380)在位且已迁移(154 篇文章 + legacy 映射)
 * :3000 被本地验收容器栈占用时,`E2E_BASE_URL=http://localhost:3100` 配合
 * `npx next start -p 3100` 走备用端口(M12 起口径,M13 制度化;mutation Origin
 * 运行时派生,任意端口可用)。
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  outputDir: ".test-results", // 点前缀隐藏:临时产物不占根目录视线(每次运行自动清空重建)
  timeout: 30_000,
  workers: 1, // 顺序执行:共享 ISR 缓存与统计缓冲,避免并发干扰
  retries: 0,
  use: {
    baseURL: BASE_URL,
  },
  webServer: {
    command: "npm run start",
    url: `${BASE_URL}/`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
