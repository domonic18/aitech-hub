/**
 * F23 词库表「关联 / 最近命中」列取数:文章数 = Post.title 命中词计数
 * (published,与 F25 簇详情「已产出文章」同口径);最近命中 = 该词在
 * discovery_candidate.hit_keywords 出现的最新一批时间。页内 20 词一次
 * unnest 往返,无匹配的词不落行(调用方以缺省值兜底)。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "../db";

export interface WordRelation {
  word: string;
  /** published 文章标题含词计数(0 起步) */
  posts: number;
  /** 最近一次作为候选命中词的批次时间(null=尚无候选命中) */
  lastHitAt: Date | null;
}

/** 页内词批量关联聚合(词表以归一形存储,小写精确匹配) */
export async function keywordRelations(words: string[]): Promise<Map<string, WordRelation>> {
  const out = new Map<string, WordRelation>();
  if (words.length === 0) return out;
  const arr = Prisma.join(words);
  const [postRows, hitRows] = await Promise.all([
    prisma.$queryRaw<{ w: string; c: bigint }[]>`
      SELECT t.w AS w,
             (SELECT count(*) FROM content_post p
               WHERE p.status = 'published' AND p.title ILIKE '%' || t.w || '%') AS c
        FROM unnest(ARRAY[${arr}]::text[]) AS t(w)`,
    prisma.$queryRaw<{ w: string; last_hit: Date | null }[]>`
      SELECT k.kw AS w, max(d.created_at) AS last_hit
        FROM discovery_candidate d
        CROSS JOIN LATERAL jsonb_array_elements_text(d.hit_keywords) AS k(kw)
       WHERE jsonb_typeof(d.hit_keywords) = 'array'
         AND k.kw = ANY(ARRAY[${arr}]::text[])
       GROUP BY k.kw`,
  ]);
  const hits = new Map(hitRows.map((r) => [r.w, r.last_hit]));
  for (const r of postRows) {
    out.set(r.w, { word: r.w, posts: Number(r.c), lastHitAt: hits.get(r.w) ?? null });
  }
  return out;
}
