/**
 * /leaderboards/ 公开读侧(M58 批③):逐榜取「最新可用日期」全量行 + 上一可用
 * 日期名次差,名次变动不落库、读时相减(方案 §6.2)。ISR SSR 直出(SEO 生命线,
 * 参考 /pricing/ 模式);空榜不出页签,全部为空出空态。
 * 数据陈旧不出错误:页面顶部「数据截至」+ 过期横幅,采集失败不静默腐烂。
 */
import { prisma } from "@/lib/db";
import { formatCnDate } from "@/lib/datetime";
import { prerenderSafe } from "@/lib/prerender-safe";

import {
  LEADERBOARD_SOURCE_LABELS,
  LEADERBOARD_SOURCE_URLS,
  type LeaderboardEntityType,
} from "./constants";
import { readSnapshotMeta, type LeaderboardItemMeta } from "./meta";
import { LEADERBOARD_DEFS } from "./registry";

/** 数据陈旧阈值(天):超过此天数未更新,公开页出降级提示 */
export const LEADERBOARD_STALE_DAYS = 2;

export interface PublicLeaderboardRow {
  rank: number;
  entityKey: string;
  entityName: string;
  entityType: LeaderboardEntityType;
  vendor: string | null;
  score: number | null;
  scoreUnit: string | null;
  url: string;
  /** 展示用附加字段(M63);历史行无该字段时为 {} */
  extra: LeaderboardItemMeta;
  /** 名次变动:正=上升位数,负=下降,0=持平,null=新入榜(无上一期) */
  delta: number | null;
}

export interface PublicLeaderboard {
  key: string;
  board: string;
  label: string;
  sourceUrl: string;
  /** 榜单实体类型(公开页按此分组:model → 模型榜、paper → 论文、repo → 仓库) */
  entityType: LeaderboardEntityType;
  /** 数据日期(YYYY-MM-DD) */
  capturedDate: string;
  /** 距今天数(北京日界);0=今日 */
  staleDays: number;
  /** 是否存在上一可用日期:false 时 delta 恒为 null,展示侧据此不标「新入榜」 */
  hasPrevious: boolean;
  rows: PublicLeaderboardRow[];
}

export interface PublicLeaderboards {
  boards: PublicLeaderboard[];
  /** 全部榜单中最新数据日期(YYYY-MM-DD);空表 null */
  asOf: string | null;
}

/** 名次差(纯函数,单测锚):上期名次 - 本期名次 = 上升位数;上期无此条 → null */
export function rankDelta(
  current: Array<{ entityKey: string; rank: number }>,
  previous: Array<{ entityKey: string; rank: number }>,
): Map<string, number | null> {
  const prevRank = new Map(previous.map((r) => [r.entityKey, r.rank]));
  return new Map(
    current.map((r) => {
      const prev = prevRank.get(r.entityKey);
      return [r.entityKey, prev === undefined ? null : prev - r.rank];
    }),
  );
}

/** JSON-LD ItemList(SEO):各榜单行拍平为有序清单;空榜不出结构化数据 */
export function buildLeaderboardJsonLd(
  data: PublicLeaderboards,
  pageUrl: string,
): Record<string, unknown> {
  const rows = data.boards.flatMap((b) => b.rows.map((r) => ({ board: b, row: r })));
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "AI 模型榜单",
    url: pageUrl,
    numberOfItems: rows.length,
    itemListElement: rows.map(({ board, row }, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "CreativeWork",
        name: row.entityName === "" ? row.entityKey : row.entityName,
        description: `${board.board} 第 ${row.rank} 名${
          row.score === null ? "" : `,${String(row.score)} ${row.scoreUnit ?? ""}`
        },数据截至 ${board.capturedDate}`,
        url: row.url === "" ? pageUrl : row.url,
      },
    })),
  };
}

/** 数据日期 → YYYY-MM-DD(@db.Date 存 UTC 零点,直接切片不退时区) */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 距今北京日数(两端都按 UTC 日锚,只差日界,不做时区换算) */
function daysBetween(fromDay: string, now: Date): number {
  const from = Date.parse(`${fromDay}T00:00:00Z`);
  const today = Date.parse(`${formatCnDate(now)}T00:00:00Z`);
  return Math.max(0, Math.round((today - from) / 86_400_000));
}

export async function listPublicLeaderboards(now: Date = new Date()): Promise<PublicLeaderboards> {
  return prerenderSafe("leaderboard.public", { boards: [], asOf: null }, async () => {
    const boards: PublicLeaderboard[] = [];
    for (const def of LEADERBOARD_DEFS) {
      const where = { source: def.key, board: def.board };
      const latest = await prisma.insightLeaderboardSnapshot.findFirst({
        where,
        orderBy: { capturedDate: "desc" },
        select: { capturedDate: true },
      });
      if (latest === null) continue;
      const previous = await prisma.insightLeaderboardSnapshot.findFirst({
        where: { ...where, capturedDate: { lt: latest.capturedDate } },
        orderBy: { capturedDate: "desc" },
        select: { capturedDate: true },
      });
      const [rows, prevRows] = await Promise.all([
        prisma.insightLeaderboardSnapshot.findMany({
          where: { ...where, capturedDate: latest.capturedDate },
          orderBy: { rank: "asc" },
          select: {
            entityKey: true,
            entityName: true,
            entityType: true,
            vendor: true,
            rank: true,
            score: true,
            scoreUnit: true,
            meta: true,
          },
        }),
        previous === null
          ? Promise.resolve([])
          : prisma.insightLeaderboardSnapshot.findMany({
              where: { ...where, capturedDate: previous.capturedDate },
              select: { entityKey: true, rank: true },
            }),
      ]);
      if (rows.length === 0) continue;
      const delta = rankDelta(rows, prevRows);
      const capturedDate = dayKey(latest.capturedDate);
      boards.push({
        key: def.key,
        board: def.board,
        label: LEADERBOARD_SOURCE_LABELS[def.key] ?? def.label,
        sourceUrl: LEADERBOARD_SOURCE_URLS[def.key] ?? def.defaultUrl,
        entityType: def.entityType,
        capturedDate,
        staleDays: daysBetween(capturedDate, now),
        hasPrevious: previous !== null,
        rows: rows.map((r) => {
          const meta = readSnapshotMeta(r.meta);
          return {
            rank: r.rank,
            entityKey: r.entityKey,
            entityName: r.entityName,
            entityType: r.entityType as LeaderboardEntityType,
            vendor: r.vendor,
            score: r.score,
            scoreUnit: r.scoreUnit,
            url: meta.url,
            extra: meta.extra,
            delta: delta.get(r.entityKey) ?? null,
          };
        }),
      });
    }
    return {
      boards,
      asOf: boards.reduce<string | null>(
        (acc, b) => (acc === null || b.capturedDate > acc ? b.capturedDate : acc),
        null,
      ),
    };
  });
}
