import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // 与 tsconfig paths 的 @/* 对齐,使测试可直接引用 src 模块
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    environment: "node",
    // 集成测试共用 dev PG/Redis 且有全局态(pay_gateway_config/限频桶),
    // 文件级并行会互踩(此前 embedding-repo 假失败同源);串行换确定性
    fileParallelism: false,
  },
});
