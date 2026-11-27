/**
 * AI 智能指数:Top 事件结构与解析
 * ai_index_daily.top_events 列(JSON)的唯一类型出口。
 */

export interface TopEvent {
  title: string;
  url: string;
  score: number;
  signed: number;
  dimension: string;
  direction: string;
  relevance: string;
}

const DIRECTIONS = new Set(["positive", "negative", "neutral"]);
const RELEVANCES = new Set(["core", "adjacent"]);

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** 从数据库 JSON 列解析 Top 事件(字段缺失或损坏时丢弃该条) */
export function parseTopEvents(raw: unknown): TopEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: TopEvent[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const title = str(rec.title).trim();
    if (!title) continue;
    const direction = str(rec.direction);
    out.push({
      title,
      url: str(rec.url),
      score: num(rec.score),
      signed: num(rec.signed),
      dimension: str(rec.dimension) || "general",
      direction: DIRECTIONS.has(direction) ? direction : "neutral",
      relevance: RELEVANCES.has(str(rec.relevance)) ? str(rec.relevance) : "core",
    });
  }
  return out;
}
