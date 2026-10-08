/**
 * COS 一次性初始化(M19 批②,幂等可重跑):npm run cos:setup
 * 前置:.env 配齐 COS_SECRET_ID/COS_SECRET_KEY/COS_REGION/COS_MEDIA_BUCKET/COS_BACKUP_BUCKET。
 * 1) 备份桶 lifecycle:backups/db/ 30 天到期删除、backups/misc/ 90 天;
 * 2) 双桶连通探针(put/head/delete 探针对象),密钥/网络/桶权限一次验清。
 */
import { loadEnvConfig } from "@next/env";
import COS from "cos-nodejs-sdk-v5";

loadEnvConfig(process.cwd());

const promisified = (cos: COS) => ({
  putBucketLifecycle: (params: COS.PutBucketLifecycleParams) =>
    new Promise<void>((resolve, reject) =>
      cos.putBucketLifecycle(params, (e) => (e ? reject(e) : resolve())),
    ),
  putObject: (params: COS.PutObjectParams) =>
    new Promise<void>((resolve, reject) =>
      cos.putObject(params, (e) => (e ? reject(e) : resolve())),
    ),
  headObject: (params: COS.HeadObjectParams) =>
    new Promise<number>((resolve, reject) =>
      cos.headObject(params, (e, d) =>
        e ? reject(e) : resolve(Number(d.headers?.["content-length"] ?? 0)),
      ),
    ),
  deleteObject: (params: COS.DeleteObjectParams) =>
    new Promise<void>((resolve, reject) =>
      cos.deleteObject(params, (e) => (e ? reject(e) : resolve())),
    ),
});

async function main(): Promise<void> {
  // env 模块 import 即校验:须等 loadEnvConfig 落好 process.env 再求值,动态 import 兜时序
  const { env } = await import("../src/lib/env");
  if (!env.COS_SECRET_ID || !env.COS_SECRET_KEY || !env.COS_REGION) {
    throw new Error("COS_SECRET_ID/COS_SECRET_KEY/COS_REGION 未配置(见 .env.example COS 段)");
  }
  if (!env.COS_MEDIA_BUCKET || !env.COS_BACKUP_BUCKET) {
    throw new Error("COS_MEDIA_BUCKET / COS_BACKUP_BUCKET 未配置(见 .env.example COS 段)");
  }
  const cos = new COS({ SecretId: env.COS_SECRET_ID, SecretKey: env.COS_SECRET_KEY });
  const api = promisified(cos);

  // 1) 备份桶 lifecycle(db 30 天 / misc 90 天;幂等整表覆盖)
  await api.putBucketLifecycle({
    Bucket: env.COS_BACKUP_BUCKET,
    Region: env.COS_REGION,
    Rules: [
      {
        ID: "db-30d",
        Status: "Enabled",
        Filter: { Prefix: "backups/db/" },
        Expiration: { Days: 30 },
      },
      {
        ID: "misc-90d",
        Status: "Enabled",
        Filter: { Prefix: "backups/misc/" },
        Expiration: { Days: 90 },
      },
    ],
  });
  console.log(`lifecycle ok: bucket=${env.COS_BACKUP_BUCKET} db=30d misc=90d`);

  // 2) 双桶探针:put → head 比对字节数 → delete(留净桶)
  const payload = Buffer.from(`aitech-hub-probe-${Date.now()}`);
  for (const [label, bucket] of [
    ["媒体桶", env.COS_MEDIA_BUCKET],
    ["备份桶", env.COS_BACKUP_BUCKET],
  ] as const) {
    const key = `probe/aitech-hub-${Date.now()}.txt`;
    await api.putObject({ Bucket: bucket, Region: env.COS_REGION, Key: key, Body: payload });
    const size = await api.headObject({ Bucket: bucket, Region: env.COS_REGION, Key: key });
    if (size !== payload.byteLength) {
      throw new Error(`${label} ${bucket} 探针 head 字节数不符(${size} ≠ ${payload.byteLength})`);
    }
    await api.deleteObject({ Bucket: bucket, Region: env.COS_REGION, Key: key });
    console.log(`probe ok: ${label}=${bucket}(${payload.byteLength}B roundtrip)`);
  }
  console.log("COS 初始化完成:桶连通、lifecycle 已设;备份任务 03:23 首跑验证 npm run backup:run");
}

void main().catch((e) => {
  console.error("cos-setup 失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});
