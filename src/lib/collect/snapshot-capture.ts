/**
 * 采集快照捕获(P0 回溯档案,2026-10-29):取数原文 + 整页截图落私有桶,
 * 元数据落 crawl_snapshot;每源保留最近 N 份,超量对象与行一并清理。
 *
 * 唯一不变式——**快照在解析之前落盘**:解析失败恰恰是最需要回溯的样本,
 * 若等到解析成功再存,改版当天正是没有证据的那天。
 *
 * 一次采集可能拍多态快照(月/季/年三 tab),故 capture 可多次调用,
 * finish 统一回写本次运行的解析结论(状态 + 总行数 + 错误原文)。
 */
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

import { prisma } from "@/lib/db";

import { SNAPSHOT_KEEP_PER_SOURCE, type SnapshotParseStatus } from "./constants";
import { snapshotStore, type SnapshotStore } from "./snapshot-store";

const gzipAsync = promisify(gzip);

/** 取数层快照回调(rendered/static 通用;png 仅 rendered 提供) */
export type SnapshotSink = (draft: SnapshotDraft) => Promise<void>;

export interface SnapshotDraft {
  /** 快照标识(monthly/quarterly/yearly/page——落 key 与库列,ASCII 稳定) */
  tab: string;
  html: string;
  httpStatus?: number | null;
  png?: Uint8Array | null;
}

/** 时间戳文件名形态:20261029T150122Z(无冒号,桶内可读且排序友好) */
function stamp(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

/** html.gz key → 同前缀 .png key(截图与原文同生命周期) */
export function snapshotPngKey(storageKey: string): string {
  return storageKey.replace(/\.html\.gz$/, ".png");
}

export class SourceCapture {
  private readonly ids: bigint[] = [];

  constructor(
    private readonly sourceId: number,
    private readonly url: string,
    private readonly store: SnapshotStore = snapshotStore,
  ) {}

  /** 落一份快照:gzip 写桶 → 建行(parseStatus=pending)→ 超量清理。
   * 存储侧故障不拖垮取数本身(档案是可观测增强,牌价才是主产物):
   * 失败以结构化事件留痕,不静默。 */
  async capture(draft: SnapshotDraft): Promise<void> {
    try {
      const raw = Buffer.from(draft.html, "utf8");
      const key = `crawl-snapshots/${this.sourceId}/${stamp(new Date())}-${draft.tab}.html.gz`;
      await this.store.put(key, await gzipAsync(raw), "application/gzip");
      const png = draft.png ?? null;
      if (png !== null) await this.store.put(snapshotPngKey(key), png, "image/png");

      const row = await prisma.crawlSnapshot.create({
        data: {
          sourceId: this.sourceId,
          url: this.url,
          tab: draft.tab,
          httpStatus: draft.httpStatus ?? null,
          sizeBytes: raw.byteLength,
          sha1: createHash("sha1").update(raw).digest("hex"),
          storageKey: key,
          hasPng: png !== null,
        },
        select: { id: true },
      });
      this.ids.push(row.id);
      await this.prune();
    } catch (e) {
      console.error(
        JSON.stringify({
          event: "crawl.snapshot.capture_failed",
          sourceId: this.sourceId,
          tab: draft.tab,
          error: String(e),
        }),
      );
    }
  }

  /** 回写本次运行结论(pending 保留=worker 中途死亡,后台可见未完成);
   * 同 capture:回写失败只留痕,不改写本次采集的成败判定 */
  async finish(
    parseStatus: Exclude<SnapshotParseStatus, "pending">,
    rowCount: number | null,
    error?: string,
  ): Promise<void> {
    if (this.ids.length === 0) return;
    try {
      await prisma.crawlSnapshot.updateMany({
        where: { id: { in: this.ids } },
        data: { parseStatus, rowCount, error: error?.slice(0, 4000) ?? null },
      });
    } catch (e) {
      console.error(
        JSON.stringify({
          event: "crawl.snapshot.finish_failed",
          sourceId: this.sourceId,
          parseStatus,
          error: String(e),
        }),
      );
    }
  }

  /** 保留最近 N 份:对象删除失败不阻断行清理(生命周期规则兜底孤儿对象) */
  private async prune(): Promise<void> {
    const stale = await prisma.crawlSnapshot.findMany({
      where: { sourceId: this.sourceId },
      orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
      skip: SNAPSHOT_KEEP_PER_SOURCE,
      select: { id: true, storageKey: true, hasPng: true },
    });
    for (const s of stale) {
      await this.store.delete(s.storageKey).catch(() => undefined);
      if (s.hasPng) await this.store.delete(snapshotPngKey(s.storageKey)).catch(() => undefined);
      await prisma.crawlSnapshot.delete({ where: { id: s.id } }).catch(() => undefined);
    }
  }
}
