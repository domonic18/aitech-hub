/**
 * 策展行落库通用编排(M56 review P2-10):模型行/套餐行的落库规则
 * (建 pending/可刷新行刷新/人工定稿行不动)与「失败源待复核打标」完全同构——
 * 此处收敛单一实现,两面(crawlers/plan-sources)以回调规格接入,表差异
 * (字段/唯一键/prisma 委托)留在各自调用点保持类型安全。
 */
import { withRecheckMark } from "./crawlers";

export interface CuratedTally {
  created: number;
  refreshed: number;
  untouched: number;
  failed: number;
}

export interface CuratedPersistSpec<R> {
  /** 渠道唯一键(vendor|key 查既有行) */
  keyOf: (r: R) => { vendor: string; key: string };
  listExisting: (
    vendors: string[],
    keys: string[],
  ) => Promise<
    Array<{ id: bigint; vendor: string; key: string; status: string; isPinned: boolean }>
  >;
  create: (r: R) => Promise<unknown>;
  update: (existingId: bigint, r: R) => Promise<unknown>;
}

export async function persistCuratedRows<R>(
  rows: R[],
  spec: CuratedPersistSpec<R>,
): Promise<CuratedTally> {
  const tally: CuratedTally = { created: 0, refreshed: 0, untouched: 0, failed: 0 };
  const existing = await spec.listExisting(
    [...new Set(rows.map((r) => spec.keyOf(r).vendor))],
    rows.map((r) => spec.keyOf(r).key),
  );
  const byKey = new Map(existing.map((e) => [`${e.vendor}|${e.key}`, e]));

  for (const r of rows) {
    const { vendor, key } = spec.keyOf(r);
    const hit = byKey.get(`${vendor}|${key}`);
    try {
      if (hit === undefined) {
        await spec.create(r);
        tally.created += 1;
      } else if (!hit.isPinned) {
        // 可刷新行一律刷(不论展示态):「是否展示」与「能否被采集覆盖」由
        // is_pinned 单独表达(M73)——停用展示的行照样跟随官方价,人工定稿
        // 的行采集不碰。原规则借 status 表达终审,把两件事挤在一列。
        await spec.update(hit.id, r);
        tally.refreshed += 1;
      } else {
        tally.untouched += 1; // 人工定稿行,采集不覆盖
      }
    } catch {
      tally.failed += 1;
    }
  }
  return tally;
}

/** 失败源旧数据整源打标(按 sourceUrl 圈定;回调圈定/写入,表差异留调用点) */
export async function markCuratedSourceStale(
  sourceUrl: string,
  now: Date,
  listBySourceUrl: (sourceUrl: string) => Promise<Array<{ id: bigint; note: string | null }>>,
  updateNote: (id: bigint, note: string) => Promise<unknown>,
): Promise<number> {
  const stale = await listBySourceUrl(sourceUrl);
  for (const row of stale) {
    await updateNote(row.id, withRecheckMark(row.note, now));
  }
  return stale.length;
}
