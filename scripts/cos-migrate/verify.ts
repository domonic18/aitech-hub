/**
 * 媒体迁移对账(M19 批③):npm run cos:verify
 * 本地清单 vs 桶 listAll:字节数全量比对 + 抽样 20 个整字节 sha1 比对(下载回读);
 * 任一差异 exit 1(修复后重跑 cos:migrate 续传再对账)。
 */
import { loadEnvConfig } from "@next/env";

import { cosWireKey } from "../../src/lib/backup/cos-bucket";
import { diffInventory, pickSamples } from "../../src/lib/backup/media-inventory";

loadEnvConfig(process.cwd());

const SAMPLES = 20;

async function main(): Promise<void> {
  // env 与 ./lib 均 import 即校验:须等 loadEnvConfig 落好 process.env 再求值,动态 import 兜时序
  const { env } = await import("../../src/lib/env");
  const {
    assertMediaCosEnv,
    cosKeyOf,
    humanBytes,
    localInventory,
    mediaBucket,
    readLocal,
    sha1Hex,
  } = await import("./lib");
  assertMediaCosEnv();
  const bucket = mediaBucket();
  const { root, items } = await localInventory();
  console.log(
    `本地:${items.size} 个文件 / ${humanBytes([...items.values()].reduce((a, b) => a + b, 0))}`,
  );
  console.log(`桶:${env.COS_MEDIA_BUCKET},列举中…`);
  // 两侧归一到 cosWireKey 空间对账(桶内解码形态 vs 本地 byte 形态)
  const remote = new Map((await bucket.listAll("")).map((o) => [cosWireKey(o.key), o.sizeBytes]));
  console.log(
    `桶内:${remote.size} 个对象 / ${humanBytes([...remote.values()].reduce((a, b) => a + b, 0))}`,
  );
  const normItems = new Map([...items].map(([k, s]) => [cosWireKey(cosKeyOf(k)), s]));

  const diff = diffInventory(normItems, remote);
  console.log(
    `对账:缺失(仅本地)${diff.missing.length} / 多余(仅桶)${diff.extra.length} / 字节数不符 ${diff.mismatch.length}`,
  );
  for (const [label, list] of [
    ["缺失", diff.missing],
    ["多余", diff.extra],
    ["不符", diff.mismatch],
  ] as const) {
    for (const key of list.slice(0, 20)) console.log(`  [${label}] ${key}`);
    if (list.length > 20) console.log(`  [${label}] … 共 ${list.length} 项`);
  }

  // 抽样整字节比对:下载回读 sha1(内容级校验,size 相同仍可能内容坏);
  // 候选取本地原始 key(盘名,readLocal 用),排除归一后缺失项;get 走桶 key(带前缀)
  const missingNorm = new Set(diff.missing);
  const candidates = [...items.keys()].filter((k) => !missingNorm.has(cosWireKey(cosKeyOf(k))));
  const samples = pickSamples(candidates, Math.min(SAMPLES, candidates.length));
  let sampleBad = 0;
  for (const key of samples) {
    const localSha = sha1Hex(await readLocal(root, key));
    const remoteBuf = await bucket.get(cosKeyOf(key));
    if (!remoteBuf || sha1Hex(remoteBuf) !== localSha) {
      sampleBad += 1;
      console.error(`  [sha1 不符] ${key}`);
    }
  }
  console.log(`抽样 sha1:${samples.length} 个,不符 ${sampleBad}`);

  if (
    diff.missing.length > 0 ||
    diff.extra.length > 0 ||
    diff.mismatch.length > 0 ||
    sampleBad > 0
  ) {
    throw new Error("对账未过:修复差异后重跑 npm run cos:migrate 续传,再本命令复核");
  }
  console.log("对账全绿:下一步 npm run cos:mark -- --yes 切 storage 标记(在能连生产库的环境跑)");
}

void main().catch((e) => {
  console.error("cos:verify 失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});
