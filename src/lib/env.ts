import { z } from "zod";

/**
 * 环境变量唯一出口(arch/00-overview §6):Zod 校验,缺项/非法启动即报。
 * 仅服务端使用;客户端组件禁止 import(密钥不进 bundle)。
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /** dev compose:pg 5434;prod:容器内 5432 */
  DATABASE_URL: z.string().startsWith("postgresql://", "DATABASE_URL 必须是 postgresql:// 连接串"),
  /** dev compose:redis 6380;prod:容器内 6379 */
  REDIS_URL: z.string().startsWith("redis://", "REDIS_URL 必须是 redis:// 连接串"),

  /** 站点对外 URL(canonical/sitemap/metadataBase 基准) */
  NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),

  /** 媒体目录(默认 workspace/media 宿主机持久化约定;生产容器由 compose x-app-env 钉死为挂载点;standard/02-cicd-deployment §3 不打进镜像) */
  MEDIA_DIR: z.string().default("workspace/media"),

  /** jose 会话签名密钥;setup 脚本自动生成,生产必配。
   *  同时经 HKDF-SHA256 派生应用密钥箱主密钥(Cookie 池/模型 API Key 加密,批⑥);
   *  轮换会使已存密文失效,需重导 Cookie、重录 API Key。 */
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET 至少 16 字符"),

  /** 腾讯云短信(三期用户短信登录;缺省留空不阻塞启动) */
  TENCENT_SMS_SECRET_ID: z.string().default(""),
  TENCENT_SMS_SECRET_KEY: z.string().default(""),
  TENCENT_SMS_SDK_APP_ID: z.string().default(""),
  TENCENT_SMS_SIGN_NAME: z.string().default(""),

  /** 抖音数据网关(M8):dev 经 compose 映射 127.0.0.1:8010;prod 容器网内服务名 */
  DOUYIN_GATEWAY_URL: z.string().default("http://127.0.0.1:8010"),

  /** 视频解读日配额(M9):单自然日 AI 判读条数上限,超限延迟 30min 重投顺延(不标败) */
  INTERPRETER_DAILY_MAX: z.coerce.number().int().min(1).default(100),
});

const parsed = serverEnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`环境变量校验失败,请对照 .env.example 补全:\n${issues}`);
}

export const env = parsed.data;
export type Env = typeof env;
