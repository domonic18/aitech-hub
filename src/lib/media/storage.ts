/**
 * 媒体存储抽象(arch/08-media §1:存储演进 URL 永不变)。
 * 一期 LocalDiskProvider(env.MEDIA_DIR,dev compose / 生产 compose 均挂 workspace/media);
 * 二期 CosProvider 实现同一接口,上层零改动。
 *
 * 路径约定:站内 URL `/wp-content/uploads/YYYY/MM/<file>` ↔ 磁盘 `$MEDIA_DIR/YYYY/MM/<file>`
 * (与 wp-content 路由、Nginx 直服、WP 迁移目录同构;新上传沿用旧站路径风格)。
 */
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

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

/** URL 路径 → 磁盘相对路径(`/wp-content/uploads/a/b` → `a/b`);非法路径返回 null */
export function uploadsUrlToRel(urlPath: string): string | null {
  const prefix = "/wp-content/uploads/";
  if (!urlPath.startsWith(prefix)) return null;
  const rel = decodeURIComponent(urlPath.slice(prefix.length));
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

  /** 供 worker 流式读取大图(避免整图进内存两次) */
  readStream(relPath: string): ReturnType<typeof createReadStream> | null {
    const p = this.abs(relPath);
    if (!existsSync(p)) return null;
    return createReadStream(p);
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

/** 全局单例(worker 与 web 共用;测试可自建实例指向临时目录) */
export const mediaStorage = new LocalDiskProvider();
