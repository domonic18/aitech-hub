/**
 * 数据库每日备份(M19 批②;M6「备份异机存放」落地,standard/02 §6):
 * pg_dump -Fc(镜像内置 postgresql-client-16)→ 本地 backups/db/ → 备份桶
 * backups/db/<名>(桶侧 30 天 lifecycle 清,scripts/cos-setup 设);本地保留最近 3 份;
 * 顺带 ssl 证书档(KB 级)入桶 misc/。Redis 不备份:队列/调度器 upsert 幂等自愈,
 * 统计缓冲可重建。失败抛错 → BullMQ failed 队列可见,不静默。
 * 副作用注入(deps):单测不起真库真桶;生产走缺省装配。
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { env } from "@/lib/env";
import { formatCnDate, formatCnTime } from "@/lib/datetime";
import { logger } from "@/lib/logger";

import { CosBucket } from "./cos-bucket";

const execFileP = promisify(execFile);

/** 本地保留份数(异机才是主保留,桶侧 30 天;本地 3 份供快速回滚) */
export const DB_BACKUP_LOCAL_KEEP = 3;

/** 备份目录约定(dev cwd=仓库根;生产 worker 挂载 /app/workspace/backups,零 env 覆盖) */
export const BACKUP_DIR = "workspace/backups";
/** ssl 证书目录(同上;生产 worker ro 挂载 /app/workspace/ssl) */
export const SSL_DIR = "workspace/ssl";

/** libpq 白名单参数(Prisma 专属 connection_limit/pgbouncer/schema 等剔除——
 *  pg_dump 对 URI 未知 query 参数直接报错;sslmode/connect_timeout 是 libpq 原生) */
const PG_LIBPQ_PARAMS = new Set(["sslmode", "connect_timeout", "application_name"]);

/** 连接串 → pg_dump 可用形态:剔非 libpq 参数,其余逐字保留 */
export function pgDumpableUrl(raw: string): string {
  const u = new URL(raw);
  const kept = new URLSearchParams();
  u.searchParams.forEach((v, k) => {
    if (PG_LIBPQ_PARAMS.has(k)) kept.set(k, v);
  });
  const q = kept.toString();
  const auth = u.username ? `${u.username}${u.password ? `:${u.password}` : ""}@` : "";
  return `${u.protocol}//${auth}${u.host}${u.pathname}${q ? `?${q}` : ""}`;
}

/** 北京时区文件名戳 aitech_hub-YYYYMMDD-HHmm(字典序即时间序,保留份数裁剪靠它) */
export function dumpStamp(now: Date): string {
  return `${formatCnDate(now).replaceAll("-", "")}-${formatCnTime(now).replace(":", "")}`;
}

/** 本地裁剪:按文件名倒序保留最近 keep 份 *.dump,返回删除数(目录缺失视为 0) */
export async function pruneLocalDumps(dir: string, keep: number): Promise<number> {
  if (!existsSync(dir)) return 0;
  const dumps = (await readdir(dir))
    .filter((f) => f.endsWith(".dump"))
    .sort()
    .reverse();
  let pruned = 0;
  for (const f of dumps.slice(keep)) {
    await rm(path.join(dir, f), { force: true });
    pruned += 1;
  }
  return pruned;
}

export interface DbBackupDeps {
  /** 备份桶(缺省按 env.COS_BACKUP_BUCKET 装配) */
  bucket?: Pick<CosBucket, "put">;
  /** pg_dump 执行(缺省 execFile pg_dump;测试注入 stub) */
  runDump?: (outPath: string) => Promise<void>;
  /** ssl 打包执行(缺省 tar czf;测试注入 stub;置 null 跳过 ssl 档) */
  packSsl?: ((outPath: string) => Promise<void>) | null;
  backupDir?: string;
  sslDir?: string;
  now?: Date;
}

export interface DbBackupResult {
  key: string;
  sizeBytes: number;
  sslKey: string | null;
  localKept: number;
  durationMs: number;
}

export async function dbBackupJob(deps: DbBackupDeps = {}): Promise<DbBackupResult> {
  if (!env.COS_BACKUP_BUCKET) {
    throw new Error("备份桶未配置:COS_BACKUP_BUCKET 为空(见 .env.example COS 段)");
  }
  const bucket =
    deps.bucket ??
    new CosBucket({
      secretId: env.COS_SECRET_ID,
      secretKey: env.COS_SECRET_KEY,
      region: env.COS_REGION,
      bucket: env.COS_BACKUP_BUCKET,
    });
  const backupDir = deps.backupDir ?? BACKUP_DIR;
  const sslDir = deps.sslDir ?? SSL_DIR;
  const t0 = Date.now();

  // 1) pg_dump -Fc(自定义格式支持单表/选择性恢复,比纯 SQL 紧凑)
  const name = `aitech_hub-${dumpStamp(deps.now ?? new Date())}.dump`;
  const dbDir = path.join(backupDir, "db");
  const localPath = path.join(dbDir, name);
  await mkdir(dbDir, { recursive: true });
  const runDump =
    deps.runDump ??
    (() =>
      execFileP("pg_dump", [
        "--format=custom",
        `--file=${localPath}`,
        `--dbname=${pgDumpableUrl(env.DATABASE_URL)}`,
      ]));
  await runDump(localPath);
  const data = await readFile(localPath);

  // 2) 上传备份桶 + 本地裁剪
  const key = `backups/db/${name}`;
  await bucket.put(key, data, "application/octet-stream");
  const localKept = await pruneLocalDumps(dbDir, DB_BACKUP_LOCAL_KEEP);

  // 3) ssl 证书档(KB 级;目录缺失/打包失败不拦 DB 备份主体,warn 留痕)
  let sslKey: string | null = null;
  if (deps.packSsl !== null && existsSync(sslDir)) {
    const sslName = `ssl-${dumpStamp(deps.now ?? new Date()).slice(0, 8)}.tgz`;
    const sslLocal = path.join(backupDir, "misc", sslName);
    try {
      await mkdir(path.dirname(sslLocal), { recursive: true });
      const pack =
        deps.packSsl ??
        (() =>
          execFileP("tar", ["-czf", sslLocal, "-C", path.dirname(sslDir), path.basename(sslDir)]));
      await pack(sslLocal);
      await bucket.put(`backups/misc/${sslName}`, await readFile(sslLocal));
      await rm(sslLocal, { force: true });
      sslKey = `backups/misc/${sslName}`;
    } catch (err) {
      logger.warn({
        event: "db.backup_ssl_failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result: DbBackupResult = {
    key,
    sizeBytes: data.byteLength,
    sslKey,
    localKept,
    durationMs: Date.now() - t0,
  };
  logger.info({ event: "db.backup_done", ...result });
  return result;
}
