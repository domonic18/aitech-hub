/**
 * 媒体存储抽象(arch/08-media §1:存储演进 URL 永不变)。
 * 一期 LocalDiskProvider(env.MEDIA_DIR,dev compose / 生产 compose 均挂 workspace/media);
 * 二期 CosProvider(M19 批①)实现同一接口,上层零改动——公网 URL 仍
 * `/wp-content/uploads/...`(nginx 反代 COS 直服),切存储不切 URL。
 *
 * 路径约定:站内 URL `/wp-content/uploads/YYYY/MM/<file>` ↔ 存储 key `$MEDIA_DIR/YYYY/MM/<file>`;
 * 段内 percent-encoding **原样同构(不 decode)**——磁盘/COS key 文件名即 URL 段的逐字节形态,
 * 与 WP 迁移闭包、Nginx `map $request_uri` 未解码直服一致;新上传沿用旧站路径风格。
 * 红线:此处一旦 decode,中文文件名(库内为 %xx 编码形态)在盘上必然打偏——
 * 2026-10-03 生产 1158 条误判断链即源于此;且 decodeURIComponent 对畸形 % 会抛 URIError。
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import COS from "cos-nodejs-sdk-v5";

import { env } from "@/lib/env";

export interface MediaStorage {
  /** 写入二进制(已 sha1 命名的相对路径),幂等覆盖 */
  put(relPath: string, data: Uint8Array): Promise<void>;
  get(relPath: string): Promise<Buffer | null>;
  /** 物理删除(不存在视为成功,幂等) */
  delete(relPath: string): Promise<void>;
  exists(relPath: string): Promise<boolean>;
  size(relPath: string): Promise<number | null>;
}

/** URL 路径 → 磁盘相对路径(`/wp-content/uploads/a/b` → `a/b`;不 decode,见文件头路径约定);非法路径返回 null */
export function uploadsUrlToRel(urlPath: string): string | null {
  const prefix = "/wp-content/uploads/";
  if (!urlPath.startsWith(prefix)) return null;
  const rel = urlPath.slice(prefix.length);
  if (!rel || rel.includes("\0") || rel.split("/").includes("..")) return null;
  return rel;
}

/** 磁盘相对路径 → 站内 URL(put 的反向;段内字符按 URL 编码保 `/`) */
export function relToUploadsUrl(relPath: string): string {
  const encoded = relPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `/wp-content/uploads/${encoded}`;
}

/** 存储后端类型(M19 批①;与 content_media.storage 列同词表 local/cos) */
export type MediaStorageKind = "local" | "cos";

/** 扩展名 → mime(put 侧定对象 Content-Type,反代透传/浏览器直开两用;迁移脚本同用) */
export const MEDIA_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".pdf": "application/pdf",
};

/** COS 连接配置(env 装配;构造期校验缺项 fail fast) */
export interface CosStorageConfig {
  secretId: string;
  secretKey: string;
  region: string;
  bucket: string;
}

/** env → COS 配置;缺项列全了一次报清(人话,启动即拦) */
export function cosConfigFromEnv(
  source: Pick<
    typeof env,
    "COS_SECRET_ID" | "COS_SECRET_KEY" | "COS_REGION" | "COS_MEDIA_BUCKET"
  > = env,
): CosStorageConfig {
  const pairs: Array<[string, string]> = [
    ["COS_SECRET_ID", source.COS_SECRET_ID],
    ["COS_SECRET_KEY", source.COS_SECRET_KEY],
    ["COS_REGION", source.COS_REGION],
    ["COS_MEDIA_BUCKET", source.COS_MEDIA_BUCKET],
  ];
  const missing = pairs.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`COS 配置缺失:MEDIA_STORAGE=cos 需补全 ${missing.join("/")}(见 .env.example)`);
  }
  return {
    secretId: source.COS_SECRET_ID,
    secretKey: source.COS_SECRET_KEY,
    region: source.COS_REGION,
    bucket: source.COS_MEDIA_BUCKET,
  };
}

/** SDK 客户端最小面(仅本抽象用到的四方法;测试注入 fake,不必起真桶) */
export type CosClient = Pick<
  InstanceType<typeof COS>,
  "putObject" | "getObject" | "headObject" | "deleteObject"
>;

/** COS 缺对象错误口径:HTTP 404 或服务端码 NoSuchKey/NotFound(headObject/getObject 双路) */
function isCosNotFound(err: unknown): boolean {
  const e = err as { statusCode?: number; code?: string } | null;
  return e?.statusCode === 404 || e?.code === "NoSuchKey" || e?.code === "NotFound";
}

/**
 * 腾讯 COS 存储Provider(arch/08-media §1 二期槽位):
 * key=relPath **原样 percent-encoded 不 decode**(与盘名/URL 逐字节同构,红线见文件头);
 * 写入即带 immutable 长缓存与 Content-Type(内容 sha1 命名不可变,微信 WP 闭包同理);
 * 删除天然幂等(COS 删不存在 key 返回成功)。桶侧纪律:公有读、私有写(arch/08 §4)。
 */
export class CosProvider implements MediaStorage {
  private readonly client: CosClient;
  private readonly bucket: string;
  private readonly region: string;

  constructor(config: CosStorageConfig, client?: CosClient) {
    this.bucket = config.bucket;
    this.region = config.region;
    this.client = client ?? new COS({ SecretId: config.secretId, SecretKey: config.secretKey });
  }

  async put(relPath: string, data: Uint8Array): Promise<void> {
    await this.client.putObject({
      Bucket: this.bucket,
      Region: this.region,
      Key: relPath,
      Body: Buffer.from(data),
      ContentType:
        MEDIA_MIME_BY_EXT[path.extname(relPath).toLowerCase()] ?? "application/octet-stream",
      CacheControl: "public, max-age=31536000, immutable",
    });
  }

  async get(relPath: string): Promise<Buffer | null> {
    try {
      const r = await this.client.getObject({
        Bucket: this.bucket,
        Region: this.region,
        Key: relPath,
      });
      return Buffer.from(r.Body);
    } catch (err) {
      if (isCosNotFound(err)) return null;
      throw err;
    }
  }

  async delete(relPath: string): Promise<void> {
    await this.client.deleteObject({ Bucket: this.bucket, Region: this.region, Key: relPath });
  }

  async exists(relPath: string): Promise<boolean> {
    return (await this.stat(relPath)) !== null;
  }

  async size(relPath: string): Promise<number | null> {
    return (await this.stat(relPath))?.size ?? null;
  }

  /** headObject 取 content-length;缺对象 null,其他错误上抛(配错桶不能装作没文件) */
  private async stat(relPath: string): Promise<{ size: number } | null> {
    try {
      const r = await this.client.headObject({
        Bucket: this.bucket,
        Region: this.region,
        Key: relPath,
      });
      const len = Number(r.headers?.["content-length"] ?? NaN);
      return { size: Number.isFinite(len) ? len : 0 };
    } catch (err) {
      if (isCosNotFound(err)) return null;
      throw err;
    }
  }
}

export class LocalDiskProvider implements MediaStorage {
  private readonly root: string;

  constructor(root?: string) {
    this.root = path.resolve(process.cwd(), root ?? env.MEDIA_DIR);
  }

  /** 相对路径 → 绝对路径;越界(穿越 MEDIA_DIR)抛错,调用方视为非法输入 */
  private abs(relPath: string): string {
    const p = path.resolve(this.root, relPath);
    if (!p.startsWith(this.root + path.sep)) {
      throw new Error(`非法存储路径:${relPath}`);
    }
    return p;
  }

  async put(relPath: string, data: Uint8Array): Promise<void> {
    const p = this.abs(relPath);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  async get(relPath: string): Promise<Buffer | null> {
    try {
      return await readFile(this.abs(relPath));
    } catch {
      return null;
    }
  }

  async delete(relPath: string): Promise<void> {
    await rm(this.abs(relPath), { force: true });
  }

  async exists(relPath: string): Promise<boolean> {
    return existsSync(this.abs(relPath));
  }

  async size(relPath: string): Promise<number | null> {
    try {
      return (await stat(this.abs(relPath))).size;
    } catch {
      return null;
    }
  }
}

/** 当前后端(web/worker 同源判定;与 content_media.storage 落库词一致) */
export const mediaStorageKind: MediaStorageKind = env.MEDIA_STORAGE === "cos" ? "cos" : "local";

/** 按类型装配(测试/脚本可显式指定;cos 缺配置在构造期抛) */
export function createMediaStorage(kind: MediaStorageKind): MediaStorage {
  if (kind === "cos") return new CosProvider(cosConfigFromEnv());
  return new LocalDiskProvider();
}

/** 全局单例(worker 与 web 共用;测试可自建实例指向临时目录/注入 fake client) */
export const mediaStorage: MediaStorage = createMediaStorage(mediaStorageKind);
