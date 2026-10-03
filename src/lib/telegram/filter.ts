/**
 * 电报流准入过滤(M7,arch/02 §3.1):屏蔽词命中 + 代码级启发式。
 * 纪律是「短、少、准」,但启发式从严列表从窄——误杀比漏杀更伤流;
 * 命中返回规则名写入 telegram.filter_hit,条目以 hidden 入库供观测。
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
