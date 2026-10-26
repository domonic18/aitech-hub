/**
 * 单域双榜融合(M20,技术债批⑤ 自 unified-search 拆出):词项榜 × 向量榜 RRF
 * 融合重排的通用骨架,三域共用。fetchSemanticRows 注入便于单测。
 */
import type { VectorMatch } from "./embedding-repo";
import {
  fuseCompare,
  rankAndCut,
  scoreTerms,
  type RankedFields,
  type ScoreFields,
} from "./search-view";

/** 每域候选上限(DB take,预排后 JS 计分重排;万行级表取新 50 条足够) */
export const CANDIDATE_LIMIT = 50;

/**
 * 词项候选 rankAndCut 全量排名(CANDIDATE_LIMIT)→ 向量榜剔除词项命中后,纯语义
 * id 按"同可见性条件"补取源行 → RRF 融合重排(fuseCompare)→ 截组限量。降级
 * (vectorTop=null)时候选仅词项榜且 RRF 严格随排名递减,序与单榜一致(行为不回归)。
 * extraTotal = 语义补召仍可见条数(并入组头 total;上限向量榜 VECTOR_RECALL_LIMIT 内)。
 */
export async function fuseDomain<Row, Hit extends { id: string; semanticOnly?: boolean }>(args: {
  keywordRows: Row[];
  vectorTop: VectorMatch[] | null;
  terms: string[];
  limit: number;
  fieldOf: (r: Row) => ScoreFields & RankedFields;
  toHit: (r: Row & { hitPct: number }) => Hit;
  fetchSemanticRows: (ids: bigint[]) => Promise<Row[]>;
}): Promise<{ items: Hit[]; extraTotal: number }> {
  const { keywordRows, vectorTop, terms, limit, fieldOf, toHit, fetchSemanticRows } = args;
  const ranked = rankAndCut(keywordRows, terms, CANDIDATE_LIMIT, fieldOf);
  const vecRankById = new Map((vectorTop ?? []).map((m, i) => [m.entityId.toString(), i] as const));
  const scored = ranked.map((row, kwRank) => {
    const f = fieldOf(row);
    return {
      row,
      hitPct: row.hitPct,
      id: f.id,
      kwRank,
      vecRank: vecRankById.get(f.id) ?? null,
      kwScore: scoreTerms(terms, f).score,
      date: f.dateIso ? Date.parse(f.dateIso) : 0,
    };
  });

  // 纯语义 id(向量榜有、词项榜无;保距降序)→ 补取源行(已下架/隐藏自然缺位)
  const kwIdSet = new Set(scored.map((c) => c.id));
  const semanticIds = (vectorTop ?? [])
    .filter((m) => !kwIdSet.has(m.entityId.toString()))
    .map((m) => m.entityId);
  const semanticRows = semanticIds.length > 0 ? await fetchSemanticRows(semanticIds) : [];
  const semantic = semanticRows.map((row) => {
    const f = fieldOf(row);
    return {
      row,
      hitPct: 0, // 语义命中不显百分比(UI 以「语义匹配」标替代)
      id: f.id,
      kwRank: null,
      vecRank: vecRankById.get(f.id) ?? null,
      kwScore: scoreTerms(terms, f).score, // 仅作词法证据 tiebreak
      date: f.dateIso ? Date.parse(f.dateIso) : 0,
    };
  });

  const candidates = [...scored, ...semantic];
  candidates.sort((a, b) => fuseCompare(a, b));
  return {
    items: candidates.slice(0, limit).map((c) => {
      const hit = toHit({ ...c.row, hitPct: c.hitPct });
      if (c.kwRank === null) hit.semanticOnly = true;
      return hit;
    }),
    extraTotal: semanticRows.length,
  };
}
