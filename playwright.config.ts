import { defineConfig } from "@playwright/test";

/**
 * E2E 冒烟(06 文档 §4,5 条以内):本地全栈验收,前置条件——
 *   1. `npm run build`(用例打的是构建产物,CI app job 不构建,E2E 在本地/发布前跑)
 *   2. pg(5434)/ redis(6380)在位且已迁移(154 篇文章 + legacy 映射)
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: ".test-results", // 点前缀隐藏:临时产物不占根目录视线(每次运行自动清空重建)
  timeout: 30_000,
  workers: 1, // 顺序执行:共享 ISR 缓存与统计缓冲,避免并发干扰
  retries: 0,
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000/",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
