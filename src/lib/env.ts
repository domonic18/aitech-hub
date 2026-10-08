import { z } from "zod";

/**
 * 环境变量唯一出口(arch/00-overview §6):Zod 校验,缺项/非法启动即报。
 * 仅服务端使用;客户端组件禁止 import(密钥不进 bundle)。
 * tsx 脚本注意:本模块 import 即校验——脚本须先 loadEnvConfig 再动态 import 本模块
 * (静态 import 会在 .env 装载前求值而误报缺项;Next 应用无此问题,env 由框架先装载)。
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

  /** 媒体存储后端(M19 批①,arch/08-media §1 演进):local=本地卷(缺省,dev 零依赖);
   *  cos=腾讯 COS(CosProvider,URL 仍 /wp-content/uploads/ 不变,nginx 反代直服) */
  MEDIA_STORAGE: z.enum(["local", "cos"]).default("local"),

  /** 腾讯云 COS(M19:媒体存储 + 数据库备份异机存放;密钥仅 env 不入库不打日志。
   *  MEDIA_STORAGE=cos 时媒体四项必配(缺项 provider 构造即抛);备份桶仅 db-backup 用,
   *  未配置时备份 job 显式失败进队列可见) */
  COS_SECRET_ID: z.string().default(""),
  COS_SECRET_KEY: z.string().default(""),
  COS_REGION: z.string().default(""),
  COS_MEDIA_BUCKET: z.string().default(""),
  COS_BACKUP_BUCKET: z.string().default(""),

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

  /** GitHub API 令牌(M11 项目展示;可选——空=未认证 60 req/h,白名单 ≤10 仓可用;
   *  配 token 提升至 5000/h。密钥仅 env,不入库不打日志) */
  GITHUB_TOKEN: z.string().default(""),
});

const parsed = serverEnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`环境变量校验失败,请对照 .env.example 补全:\n${issues}`);
}

export const env = parsed.data;
export type Env = typeof env;
