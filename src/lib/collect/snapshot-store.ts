/**
 * 采集快照对象存储(2026-10-29 P0 回溯档案):私有桶 + 本地回落。
 *
 * 与媒体存储刻意解耦——媒体桶公有读、key 钉死 /wp-content/uploads/,而快照是
 * 第三方站点原文(版权/被索引风险),只能进私有桶;故不复用 MediaStorage,
 * 直接复用 backup/cos-bucket 的裸对象原语(listAll 不需要)。
 *
 * 桶:COS_BACKUP_BUCKET(已用于 DB 备份);未配置(本地开发)回落
 * workspace/snapshots——容器内该路径非持久卷,仅作 dev 兜底,生产必须配桶。
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { CosBucket } from "@/lib/backup/cos-bucket";
import { env } from "@/lib/env";

export interface SnapshotStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

/** 快照桶是否可用(缺任一凭据即回落本地:不许半配状态静默写丢) */
export function isCosSnapshotConfigured(
  source: Pick<
    typeof env,
    "COS_SECRET_ID" | "COS_SECRET_KEY" | "COS_REGION" | "COS_BACKUP_BUCKET"
  > = env,
): boolean {
  return Boolean(
    source.COS_SECRET_ID && source.COS_SECRET_KEY && source.COS_REGION && source.COS_BACKUP_BUCKET,
  );
}

class CosSnapshotStore implements SnapshotStore {
  private readonly bucket: CosBucket;

  constructor() {
    this.bucket = new CosBucket({
      secretId: env.COS_SECRET_ID,
      secretKey: env.COS_SECRET_KEY,
      region: env.COS_REGION,
      bucket: env.COS_BACKUP_BUCKET,
    });
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    // 私有内容:禁共享缓存(审核视角的临时证据,不进 CDN)
    await this.bucket.put(key, data, contentType, "private, max-age=0");
  }

  async get(key: string): Promise<Buffer | null> {
    return this.bucket.get(key);
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}

class LocalSnapshotStore implements SnapshotStore {
  private readonly root: string;

  constructor(root?: string) {
    this.root = path.resolve(process.cwd(), root ?? "workspace/snapshots");
  }

  private abs(key: string): string {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error(`非法快照 key:${key}`);
    return p;
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const p = this.abs(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  async get(key: string): Promise<Buffer | null> {
    const p = this.abs(key);
    if (!existsSync(p)) return null;
    return readFile(p);
  }

  async delete(key: string): Promise<void> {
    await rm(this.abs(key), { force: true });
  }
}

export function createSnapshotStore(): SnapshotStore {
  return isCosSnapshotConfigured() ? new CosSnapshotStore() : new LocalSnapshotStore();
}

/** 全局单例(worker/web 同源判定;测试可自建实例注入) */
export const snapshotStore: SnapshotStore = createSnapshotStore();
