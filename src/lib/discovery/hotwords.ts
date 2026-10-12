/**
 * 任务A·热词日频发现(M25,discovery-plan §3):词库 active 词 → bili/bing
 * suggest 直拉联想 → 归一去重 → 与词库比对 → 新词 pending 落库等人工确认。
 * 已存在词(含 dismissed)不复活;种子词 touch 作 LRU 锚。
 * 失败隔离:单(源,词)失败计数留痕,不弃整轮。
 */
import { logger } from "../logger";

import { fetchSuggestions, DEFAULT_SUGGEST_SOURCES } from "./suggest";
import {
  findExistingWords,
  insertHotwords,
  normalizeWord,
  takeActiveWords,
  touchWords,
  WORD_MAX_LEN,
} from "./keywords";

export interface HotwordsOutcome {
  /** 本轮种子词数 */
  seeds: number;
  /** 归一去重后的联想词总数(不含种子自身) */
  suggestions: number;
  /** 新落库数(pending) */
  inserted: number;
  /** 失败(源,词)对数 */
  failures: number;
}

export async function runHotwordsDiscovery(cap: number): Promise<HotwordsOutcome> {
  const seeds = await takeActiveWords(cap);
  const outcome: HotwordsOutcome = {
    seeds: seeds.length,
    suggestions: 0,
    inserted: 0,
    failures: 0,
  };
  if (seeds.length === 0) return outcome;

  const yields = await fetchSuggestions(
    DEFAULT_SUGGEST_SOURCES,
    seeds.map((s) => s.word),
  );

  // 归一去重:同词多源首见源优先;剔除空/超长/种子自身
  const seedSet = new Set(seeds.map((s) => normalizeWord(s.word)));
  const sourceByWord = new Map<string, string>();
  for (const y of yields) {
    if (y.error !== null) {
      outcome.failures += 1;
      logger.warn({
        event: "discovery.hotwords.source_failed",
        source: y.source,
        seed: y.seed,
        error: y.error,
      });
      continue;
    }
    for (const raw of y.suggestions) {
      const word = normalizeWord(raw);
      if (!word || word.length > WORD_MAX_LEN) continue;
      if (seedSet.has(word) || sourceByWord.has(word)) continue;
      sourceByWord.set(word, y.source);
    }
  }
  outcome.suggestions = sourceByWord.size;

  const words = [...sourceByWord.keys()];
  const existing = await findExistingWords(words);
  const fresh = words.filter((w) => !existing.has(w));
  const inserted = await insertHotwords(fresh, sourceByWord);
  outcome.inserted = inserted.inserted;

  await touchWords(seeds.map((s) => s.id));
  logger.info({ event: "discovery.hotwords.done", ...outcome });
  return outcome;
}
