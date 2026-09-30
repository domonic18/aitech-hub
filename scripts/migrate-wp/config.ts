/**
 * 迁移脚本配置:密钥仅 env,不落代码。
 * 源库走 MIGRATE_SOURCE_URL(本地经 wp_mysql_fwd 容器 13306 端口转发,
 * 或生产只读隧道);目标库复用 .env 的 DATABASE_URL。
 */
import { loadEnvConfig } from "@next/env";
import { join } from "node:path";

loadEnvConfig(process.cwd());

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`缺少环境变量 ${key}(.env 中配置后重试)`);
  return v;
}

export const config = {
  /** mysql 源连接串:mysql://user:pass@127.0.0.1:13306/wordpress_db */
  sourceUrl: () => requireEnv("MIGRATE_SOURCE_URL"),
  /** WP 表前缀(生产库若改过前缀则配 MIGRATE_TABLE_PREFIX) */
  tablePrefix: () => process.env.MIGRATE_TABLE_PREFIX ?? "wp_",
  /** postgres 目标连接串(与主应用一致) */
  targetUrl: () => requireEnv("DATABASE_URL"),
  /** 源站 uploads 根目录(文件拷贝源) */
  uploadsDir: () =>
    process.env.MIGRATE_UPLOADS_DIR ??
    join(process.cwd(), "../17aitech/wordpress_data/wp-content/uploads"),
  /** 媒体落盘根目录(URL /wp-content/uploads/X → workspace/media/X,03 §5);同 MEDIA_DIR 约定 */
  mediaDir: () => join(process.cwd(), process.env.MEDIA_DIR ?? "workspace/media"),
  artifactsDir: () => join(process.cwd(), "scripts/migrate-wp/artifacts"),
} as const;

/** extract → transform 阶段的产物文件名 */
export const ARTIFACTS = {
  posts: "extract-posts.json",
  legacyPosts: "extract-legacy-posts.json",
  postMeta: "extract-postmeta.json",
  terms: "extract-terms.json",
  rels: "extract-relationships.json",
  users: "extract-users.json",
  userMeta: "extract-usermeta.json",
  yoast: "extract-yoast.json",
  viewsDaily: "extract-views-daily.json",
  viewsTotal: "extract-views-total.json",
  orders: "premium-orders.json", // §7 付费权益证据(一期只导出不入库)
  transform: {
    result: "transform-result.json",
    report: "migration_report.json",
    base64Dir: "base64-media",
  },
  manifest: {
    filesFrom: "media_files_from.txt",
    copySummary: "media-copy-summary.json",
  },
  verify: "verify_report.json",
} as const;
