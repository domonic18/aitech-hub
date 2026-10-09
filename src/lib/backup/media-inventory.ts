/**
 * 媒体清单对账纯函数(M19 批③):目录清点、本地/桶清单差集、抽样。
 * 原消费方 scripts/cos-migrate/* 已随媒体迁移完结删除(git 历史可查);
 * 当前仅单测消费,留作后续媒体对账场景复用。
 * key 约定:相对 MEDIA_DIR 的 POSIX 路径,percent-encoded 原样不 decode(storage.ts 红线)。
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

/** 递归清点目录下全部文件,返回相对 root 的 POSIX 路径(不 decode;root 不存在 → 空) */
export async function walkFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.isFile()) {
      out.push(
        path
          .relative(root, path.join(e.parentPath ?? e.path, e.name))
          .split(path.sep)
          .join("/"),
      );
    }
  }
  return out.sort();
}

export interface InventoryDiff {
  /** 仅本地有(未上传/漏传) */
  missing: string[];
  /** 仅桶有(本地已删/多传) */
  extra: string[];
  /** 两侧都有但字节数不符(传坏/截断) */
  mismatch: string[];
}

/** 本地(key→size)与桶(key→size)清单对账 */
export function diffInventory(
  local: Map<string, number>,
  remote: Map<string, number>,
): InventoryDiff {
  const missing: string[] = [];
  const mismatch: string[] = [];
  for (const [key, size] of local) {
    const r = remote.get(key);
    if (r === undefined) missing.push(key);
    else if (r !== size) mismatch.push(key);
  }
  const extra: string[] = [];
  for (const key of remote.keys()) {
    if (!local.has(key)) extra.push(key);
  }
  return { missing, extra, mismatch };
}

/** 确定性抽样(n 超总量取全量;seed 可复现,便于报告对得上) */
export function pickSamples<T>(items: T[], n: number, seed = 42): T[] {
  if (n >= items.length) return [...items];
  // LCG 确定性伪随机:同 seed 同序列,抽样可复现
  let state = seed >>> 0;
  const next = (): number => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}
