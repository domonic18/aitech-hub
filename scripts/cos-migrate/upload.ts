/**
 * 媒体全量/增量上传 COS(M19 批③):npm run cos:migrate [-- --dry-run]
 * walk MEDIA_DIR 全部文件 → 桶 key = wp-content/uploads/ 前缀 + 相对路径(URL 树
 * 同构,nginx 反代透传即命中;percent-encoded 不 decode,CosBucket 内部转 COS 语义);
 * 桶内同 key 同字节数跳过(可中断重跑 = 断点续传);4 并发,单文件失败重试 2 次。
 */
import { loadEnvConfig } from "@next/env";

import { CosBucket, cosWireKey } from "../../src/lib/backup/cos-bucket";

loadEnvConfig(process.cwd());

const CONCURRENCY = 4;
const RETRIES = 2;

async function main(): Promise<void> {
  // ./lib 静态依赖 env(import 即校验):须等 loadEnvConfig 落好 process.env 再求值,动态 import 兜时序
  const {
    assertMediaCosEnv,
    cosKeyOf,
    humanBytes,
    localInventory,
    mediaBucket,
    mimeOf,
    readLocal,
  } = await import("./lib");
  assertMediaCosEnv();
  const dryRun = process.argv.includes("--dry-run");
  // dry-run 只读(list 对账增量),不触发任何 put
  const bucket: CosBucket | null = dryRun ? null : mediaBucket();
  const { root, items } = await localInventory();
  const totalBytes = [...items.values()].reduce((a, b) => a + b, 0);
  console.log(
    `本地媒体:${items.size} 个文件 / ${humanBytes(totalBytes)}(root=${root})${dryRun ? " [dry-run]" : ""}`,
  );
  if (items.size === 0) return;

  // 桶内 key 是前缀+解码形态,本地清点是 byte 形态:cosWireKey 归一后比 size
  const remote = bucket
    ? new Map((await bucket.listAll("")).map((o) => [cosWireKey(o.key), o.sizeBytes]))
    : new Map<string, number>();
  const todo: string[] = [];
  let skipped = 0;
  for (const [key, size] of items) {
    if (remote.get(cosWireKey(cosKeyOf(key))) === size) {
      skipped += 1;
    } else {
      todo.push(key);
    }
  }
  console.log(`桶内已有同 size 跳过 ${skipped},待上传 ${todo.length}`);

  if (dryRun) {
    for (const key of todo.slice(0, 20))
      console.log(`  would upload: ${key}(${humanBytes(items.get(key) ?? 0)})`);
    if (todo.length > 20) console.log(`  … 共 ${todo.length} 项`);
    return;
  }

  if (!bucket) throw new Error("unreachable:dry-run 已提前返回");
  let uploaded = 0;
  let failed = 0;
  const failures: string[] = [];
  let done = 0;
  const put = bucket.put.bind(bucket);
  const uploadOne = async (key: string): Promise<void> => {
    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
      try {
        await put(cosKeyOf(key), await readLocal(root, key), mimeOf(key));
        uploaded += 1;
        return;
      } catch (err) {
        if (attempt === RETRIES) {
          failed += 1;
          failures.push(key);
          console.error(`  上传失败 ${key}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  };
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const key = queue.shift();
        if (!key) break;
        await uploadOne(key);
        done += 1;
        if (done % 50 === 0 || done === todo.length) {
          console.log(`进度 ${done}/${todo.length}`);
        }
      }
    }),
  );

  console.log(
    `完成:上传 ${uploaded} / 跳过 ${skipped} / 失败 ${failed}` +
      (failures.length > 0 ? `\n失败清单(重跑即续传):${failures.slice(0, 20).join(", ")}` : ""),
  );
  if (failed > 0) process.exit(1);
  console.log("下一步:npm run cos:verify 对账全绿后再 npm run cos:mark -- --yes");
}

void main().catch((e) => {
  console.error("cos:migrate 失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});
