/**
 * 电报流准入过滤(M7,arch/02 §3.1):屏蔽词命中 + 代码级启发式。
 * 纪律是「短、少、准」,但启发式从严列表从窄——误杀比漏杀更伤流;
 * 命中返回规则名写入 telegram.filter_hit,条目以 hidden 入库供观测。
 * 主题准入(M14):crawl_source.config.includeKeywords 非空时,标题/摘要
 * 命中任一关键词才允许入库——全站源(雷峰网/36kr 等)防非 AI 噪音灌流;
 * 主题外条目直接跳过不入库(与 hidden 的「落库供观测」语义不同)。
 */
import { looksGarbled } from "./normalize";

import {
  BLOCKLIST_SCOPE_ALL,
  BLOCKLIST_SCOPE_SUMMARY,
  BLOCKLIST_SCOPE_TITLE,
  type BlocklistScope,
} from "./constants";

export interface BlocklistWord {
  word: string;
  scope: BlocklistScope;
}

export interface FilterHit {
  rule: string;
  word: string;
}

/** 屏蔽词:scope 限定匹配字段;大小写不敏感(lower() 比对,勿依赖 collation) */
export function matchBlocklist(
  title: string,
  summary: string,
  words: readonly BlocklistWord[],
): FilterHit | null {
  const t = title.toLowerCase();
  const s = summary.toLowerCase();
  for (const { word, scope } of words) {
    const w = word.toLowerCase();
    if (!w) continue;
    if (
      (scope === BLOCKLIST_SCOPE_TITLE && t.includes(w)) ||
      (scope === BLOCKLIST_SCOPE_SUMMARY && s.includes(w)) ||
      (scope === BLOCKLIST_SCOPE_ALL && (t.includes(w) || s.includes(w)))
    ) {
      return { rule: `blocklist:${word}`, word };
    }
  }
  return null;
}

/** 一期广告/导流关键词(从窄起步,运营期随 filter_hit 观测增删) */
const AD_KEYWORDS = ["限时优惠", "免费领取", "点击领取", "扫码关注", "广告合作", "赞助商"];

/** 一期标题党词(中文场景高频套路) */
const CLICKBAIT_WORDS = ["震惊", "速看", "惊呆", "删前速看", "转发收藏"];

function hitAny(words: readonly string[], text: string): string | null {
  for (const w of words) if (text.includes(w)) return w;
  return null;
}

/** 启发式:广告导流(title)/标题党(title)/编码异常(摘要候选)→ 规则名;干净返回 null */
export function matchHeuristics(title: string, summaryCandidate: string): FilterHit | null {
  const ad = hitAny(AD_KEYWORDS, title);
  if (ad) return { rule: `ad_kw:${ad}`, word: ad };
  const bait = hitAny(CLICKBAIT_WORDS, title);
  if (bait) return { rule: `clickbait:${bait}`, word: bait };
  if (looksGarbled(summaryCandidate)) return { rule: "garbled", word: "" };
  return null;
}

/** includeKeywords 上限:防 config 手滑塞大数组拖慢逐条匹配 */
const INCLUDE_KEYWORDS_MAX = 10;
const INCLUDE_KEYWORD_MAX_LEN = 30;

/** 解析 crawl_source.config 的 includeKeywords:容错脏数据(非数组/非串条目静默滤除);
 * trim 去空、截 10 个、单个截 30 字符。config 为空/无该键 → 空数组(= 不启用主题准入) */
export function parseIncludeKeywords(config: unknown): string[] {
  if (config === null || typeof config !== "object" || Array.isArray(config)) return [];
  const raw = (config as Record<string, unknown>).includeKeywords;
  if (!Array.isArray(raw)) return [];
  const words = raw
    .filter((w): w is string => typeof w === "string")
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    .map((w) => w.slice(0, INCLUDE_KEYWORD_MAX_LEN));
  return words.slice(0, INCLUDE_KEYWORDS_MAX);
}

/** 主题准入判定:关键词为空 = 不启用恒放行;大小写不敏感(英文渠道),标题或摘要候选命中任一即放行 */
export function matchesIncludeKeywords(
  title: string,
  summary: string,
  keywords: readonly string[],
): boolean {
  if (keywords.length === 0) return true;
  const t = title.toLowerCase();
  const s = summary.toLowerCase();
  return keywords.some((k) => {
    const w = k.toLowerCase();
    return t.includes(w) || s.includes(w);
  });
}
