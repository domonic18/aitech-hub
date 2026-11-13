/**
 * 信号增量流(M72 抽取):按 (signal_at, id) 游标翻页的 keyset 取数。
 *
 * 为什么不用 admin 的 listInsightSignals:那是 offset 分页(skip/take),
 * 并发插入下会漂移——自动化流水线要的是「两轮之间的增量」,必须 keyset。
 * list_hot_topics 是簇级聚合投影(丢了事件粒度,轮询会漏掉两轮之间
 * 爆发又回落、或中途掉榜的话题),本文件补的就是这个缺口。
 *
 * 口径:与 admin 同源——恒限在役源(buildSignalWhere 内)、同一 select 与
 * 行投影(mapSignalRow),不另起一套。
 */
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

import { buildSignalWhere, mapSignalRow, SIGNAL_SELECT, type InsightSignalRow } from "./admin";
import { SIGNAL_TAKE_DEFAULT, SIGNAL_TAKE_MAX } from "./constants";
import type { InsightSource } from "./source-registry";

export interface SignalsFeedQuery {
  /** 起点:只取 signal_at >= 该时刻的信号(时间游标入口) */
  since?: Date;
  /** 续页游标(不透明串,含 signal_at 与 id);与 since 可并存(取交集) */
  cursor?: string;
  limit?: number;
  domain?: string;
  source?: InsightSource;
  region?: string;
}

export interface SignalsFeedPage {
  items: InsightSignalRow[];
  /** 下一页游标;null 表示已到末尾 */
  nextCursor: string | null;
}

/** 游标编解码:base64url(ISO 时间|信号 id),不透明、防手改 */
function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { at: Date; id: bigint } {
  let raw: string;
  try {
    raw = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new Error("游标不合法");
  }
  const sep = raw.lastIndexOf("|");
  if (sep <= 0) throw new Error("游标不合法");
  const at = new Date(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (Number.isNaN(at.getTime()) || !/^\d+$/.test(id)) throw new Error("游标不合法");
  return { at, id: BigInt(id) };
}

/**
 * 取信号增量流(倒序:最新在前)。排序 signal_at DESC, id DESC——
 * 同刻信号用 id 兜底保证全序,游标翻页不重不漏。
 */
export async function listInsightSignalsSince(q: SignalsFeedQuery): Promise<SignalsFeedPage> {
  const limit = Math.min(Math.max(q.limit ?? SIGNAL_TAKE_DEFAULT, 1), SIGNAL_TAKE_MAX);
  const and: Prisma.InsightSignalWhereInput[] = [
    buildSignalWhere({
      ...(q.source === undefined ? {} : { source: q.source }),
      ...(q.domain === undefined ? {} : { domain: q.domain }),
      ...(q.region === undefined ? {} : { region: q.region }),
      ...(q.since === undefined ? {} : { from: q.since }),
    }),
  ];
  if (q.cursor !== undefined) {
    const c = decodeCursor(q.cursor);
    // keyset:(signal_at, id) < (游标 signal_at, 游标 id)
    and.push({
      OR: [{ signalAt: { lt: c.at } }, { signalAt: c.at, id: { lt: c.id } }],
    });
  }
  // 多取一条判是否还有下一页(避免「取满即断」把最后一页误判为有后续)
  const rows = await prisma.insightSignal.findMany({
    where: { AND: and },
    orderBy: [{ signalAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: SIGNAL_SELECT,
  });
  const page = rows.slice(0, limit);
  const items = page.map(mapSignalRow);
  const last = page[page.length - 1];
  return {
    items,
    nextCursor:
      rows.length > limit && last ? encodeCursor(last.signalAt, last.id.toString()) : null,
  };
}
