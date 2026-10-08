/**
 * 媒体 COS 迁移脚本公共装配(M19 批③)。三个入口共用:
 *   npm run cos:migrate            全量/增量上传(同 size 跳过 = 断点续传)
 *   npm run cos:verify             本地 vs 桶对账(size 全量 + sha1 抽样)
 *   npm run cos:mark               对账通过后 content_media.storage → cos(--yes 生效)
 * 前置:.env 配 COS_SECRET_ID/COS_SECRET_KEY/COS_REGION/COS_MEDIA_BUCKET;
 * 上传/对账在本机跑(媒体卷本机即全量闭包),mark 在能连生产库的环境跑(175 容器内)。
 */
import { createHash } from "node:crypto";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";

import { env } from "../../src/lib/env";
import { CosBucket } from "../../src/lib/backup/cos-bucket";
import { MEDIA_MIME_BY_EXT } from "../../src/lib/media/storage";
import { walkFiles } from "../../src/lib/backup/media-inventory";

export function assertMediaCosEnv(): void {
  const missing = (
    ["COS_SECRET_ID", "COS_SECRET_KEY", "COS_REGION", "COS_MEDIA_BUCKET"] as const
  ).filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(`COS 配置缺失:${missing.join("/")}(见 .env.example COS 段)`);
  }
}

export function mediaBucket(): CosBucket {
  return new CosBucket({
    secretId: env.COS_SECRET_ID,
    secretKey: env.COS_SECRET_KEY,
    region: env.COS_REGION,
    bucket: env.COS_MEDIA_BUCKET,
  });
}

/** 本地媒体清单 key → 字节数(key=相对 MEDIA_DIR 的 POSIX 路径,原样不 decode) */
export async function localInventory(): Promise<{
  root: string;
  items: Map<string, number>;
}> {
  const root = path.resolve(process.cwd(), env.MEDIA_DIR);
  const files = await walkFiles(root);
  const items = new Map<string, number>();
  for (const rel of files) {
    items.set(rel, (await stat(path.join(root, rel))).size);
  }
  return { root, items };
}

export function mimeOf(key: string): string {
  return MEDIA_MIME_BY_EXT[path.extname(key).toLowerCase()] ?? "application/octet-stream";
}

export function sha1Hex(data: Buffer): string {
  return createHash("sha1").update(data).digest("hex");
}

export async function readLocal(root: string, key: string): Promise<Buffer> {
  return readFile(path.join(root, key));
}

/** 人话字节 */
export function humanBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)}GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${n}B`;
}
