/**
 * vitest 全局 setup:显式加载 .env(ARCH env.ts 启动校验依赖)。
 * 此前靠 @prisma/client 运行时隐式 dotenv 副作用供 env——测试一旦 vi.mock("../db")
 * 该副作用消失,logger→env 校验即炸(K1 批② 踩坑);显式化后不再依赖隐式行为。
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
