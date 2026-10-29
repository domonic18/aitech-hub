/**
 * 采集快照后台读侧(2026-10-29 P0 回溯档案):列表/详情/原文与截图字节。
 * 只做「看」——解析口径仍在各源 parser,本文件不解析、不改状态,读操作无副作用。
 *
 * 列表只查元数据表(不列桶目录:桶内对象前缀扫全量成本随源数线性增长,
 * 且行才是真相源——对象存在的意义由行指认)。
 */
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

import { prisma } from "@/lib/db";

import { snapshotPngKey } from "./snapshot-capture";
import { isCosSnapshotConfigured, snapshotStore } from "./snapshot-store";

const gunzipAsync = promisify(gunzip);

/** 后台列表上限(保留策略每源 20 份,留余量防策略调整后看不到历史) */
export const SNAPSHOT_LIST_LIMIT = 50;

export interface SnapshotTabView {
  id: string;
  capturedAt: Date;
  tab: string | null;
  httpStatus: number | null;
  sizeBytes: number;
  sha1: string;
  parseStatus: string;
  rowCount: number | null;
  error: string | null;
  hasPng: boolean;
}

export interface SourceSnapshotView {
  source: {
    id: number;
    name: string;
    label: string;
    url: string;
    type: string;
  } | null;
  /** 存储落点(私有桶 / 本地兜底)——后台明示,排查时先确认写到哪了 */
  storage: "cos" | "local";
  rows: SnapshotTabView[];
}

/** 单源快照时间线(源不存在 → source=null,页面 404) */
export async function listSourceSnapshots(sourceId: number): Promise<SourceSnapshotView> {
  const source = await prisma.crawlSource.findUnique({
    where: { id: sourceId },
    select: { id: true, name: true, remark: true, url: true, type: true },
  });
  const rows =
    source === null
      ? []
      : await prisma.crawlSnapshot.findMany({
          where: { sourceId },
          orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
          take: SNAPSHOT_LIST_LIMIT,
          select: {
            id: true,
            capturedAt: true,
            tab: true,
            httpStatus: true,
            sizeBytes: true,
            sha1: true,
            parseStatus: true,
            rowCount: true,
            error: true,
            hasPng: true,
          },
        });
  return {
    source:
      source === null
        ? null
        : {
            id: source.id,
            name: source.name,
            label: source.remark ?? source.name,
            url: source.url,
            type: source.type,
          },
    storage: isCosSnapshotConfigured() ? "cos" : "local",
    rows: rows.map((r) => ({ ...r, id: r.id.toString() })),
  };
}

export interface SnapshotDetailView extends SnapshotTabView {
  url: string;
  storageKey: string;
  sourceLabel: string;
}

/** 单份快照详情(id 兼校验归属源,防跨源误看) */
export async function getSnapshotDetail(
  sourceId: number,
  snapshotId: bigint,
): Promise<SnapshotDetailView | null> {
  const row = await prisma.crawlSnapshot.findFirst({
    where: { id: snapshotId, sourceId },
    select: {
      id: true,
      capturedAt: true,
      url: true,
      tab: true,
      httpStatus: true,
      sizeBytes: true,
      sha1: true,
      parseStatus: true,
      rowCount: true,
      error: true,
      hasPng: true,
      storageKey: true,
      source: { select: { remark: true, name: true } },
    },
  });
  if (row === null) return null;
  return {
    id: row.id.toString(),
    capturedAt: row.capturedAt,
    tab: row.tab,
    httpStatus: row.httpStatus,
    sizeBytes: row.sizeBytes,
    sha1: row.sha1,
    parseStatus: row.parseStatus,
    rowCount: row.rowCount,
    error: row.error,
    hasPng: row.hasPng,
    url: row.url,
    storageKey: row.storageKey,
    sourceLabel: row.source.remark ?? row.source.name,
  };
}

/** 取快照原文(写入侧 gzip,读出侧解压;对象缺失 = null) */
export async function readSnapshotHtml(storageKey: string): Promise<string | null> {
  const gz = await snapshotStore.get(storageKey);
  if (gz === null) return null;
  return (await gunzipAsync(gz)).toString("utf8");
}

/** 取整页截图(未存图 = null) */
export async function readSnapshotPng(storageKey: string): Promise<Buffer | null> {
  return snapshotStore.get(snapshotPngKey(storageKey));
}

/** 后台取文件(view=快照原页预览 / raw=源码 / png=截图;对象缺失 = null) */
export async function loadSnapshotFile(
  snapshotId: bigint,
  kind: "view" | "raw" | "png",
): Promise<{ body: Buffer; contentType: string } | null> {
  const row = await prisma.crawlSnapshot.findUnique({
    where: { id: snapshotId },
    select: { storageKey: true, hasPng: true },
  });
  if (row === null) return null;
  if (kind === "png") {
    if (!row.hasPng) return null;
    const png = await readSnapshotPng(row.storageKey);
    return png === null ? null : { body: png, contentType: "image/png" };
  }
  const html = await readSnapshotHtml(row.storageKey);
  if (html === null) return null;
  return {
    body: Buffer.from(html, "utf8"),
    contentType: kind === "raw" ? "text/plain; charset=utf-8" : "text/html; charset=utf-8",
  };
}
