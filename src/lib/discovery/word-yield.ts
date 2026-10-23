/**
 * 词库产出效能(批② 词动线):生效词是发现管线的「燃料」,本域回答「哪些词
 * 真正挖到了候选」。零 schema 变更——产出由 discovery_candidate.hit_keywords
 * 聚合推导(jsonb 展开),批准候选加权得云图字重。查询供源管理·词库(效能云
 * +产出列),keywordYieldWeight 纯函数为测试锚点。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "../db";

/** 单词产出聚合行(candidates 含全部状态;approved 为质量信号) */
export interface KeywordYield {
  word: string;
  candidates: number;
  approved: number;
  maxPlay: number | null;
}

/** 云图字重:候选命中数为主,批准候选 ×3 加权(产出质量信号) */
export function keywordYieldWeight(y: { candidates: number; approved: number }): number {
  return y.candidates + y.approved * 3;
}

/** 按词聚合候选产出(全量候选,不限状态;空词跳过;Top N 按产出降序)。
 *  days 给定时窗口化(F11「种子词产出榜 · 近 7 天」),缺省全期(词库效能) */
export async function keywordYieldAdmin(
  opts: { limit?: number; days?: number } = {},
): Promise<KeywordYield[]> {
  const { limit = 60, days } = opts;
  const rows = await prisma.$queryRaw<
    {
      word: string;
      candidates: bigint;
      approved: bigint;
      max_play: bigint | null;
    }[]
  >`
    SELECT t.kw AS word,
           COUNT(*)::bigint AS candidates,
           COUNT(*) FILTER (WHERE t.status = 'approved')::bigint AS approved,
           MAX(t.max_play) AS max_play
    FROM (
      SELECT kw, d.status, d.max_play, d.created_at
      FROM discovery_candidate d
      CROSS JOIN LATERAL jsonb_array_elements_text(d.hit_keywords) AS kw
      WHERE jsonb_typeof(d.hit_keywords) = 'array'
    ) t
    WHERE t.kw <> ''${
      days === undefined
        ? Prisma.empty
        : Prisma.sql` AND t.created_at >= now() - make_interval(days => ${days}::int)`
    }
    GROUP BY t.kw
    ORDER BY candidates DESC, approved DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({
    word: r.word,
    candidates: Number(r.candidates),
    approved: Number(r.approved),
    maxPlay: r.max_play === null ? null : Number(r.max_play),
  }));
}
