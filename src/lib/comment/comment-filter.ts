/**
 * 评论准入过滤(M23):复用 blocklist 表,scope ∈ {comment, all} 命中即拒提交。
 * 先发后审模式下这是唯一的自动闸,与限流共同把守垃圾窗口;电报流的启发式
 * (广告/标题党/garbled)不适用纯文字短评,不引入(从窄,误杀比漏杀更伤互动)。
 */
import type { BlocklistWord, FilterHit } from "@/lib/telegram/filter";

import { BLOCKLIST_SCOPE_ALL, BLOCKLIST_SCOPE_COMMENT } from "@/lib/telegram/constants";

/** 评论可命中的屏蔽词范围(scope=comment/all 的启用词;调用方负责查库传入) */
export function isCommentScopeWord({ scope }: Pick<BlocklistWord, "scope">): boolean {
  return scope === BLOCKLIST_SCOPE_COMMENT || scope === BLOCKLIST_SCOPE_ALL;
}

/** 屏蔽词命中判定:大小写不敏感(lower() 比对,勿依赖 collation;telegram 同款) */
export function matchCommentBlocklist(
  content: string,
  words: readonly BlocklistWord[],
): FilterHit | null {
  const c = content.toLowerCase();
  for (const { word, scope } of words) {
    if (!isCommentScopeWord({ scope })) continue;
    const w = word.toLowerCase();
    if (w && c.includes(w)) {
      return { rule: `blocklist:${word}`, word };
    }
  }
  return null;
}
