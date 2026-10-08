/**
 * 搜索切词(K1,arch/04 §3.2):q → 检索词项列表。
 * 取向定稿:PG simple 分词器对中文无效(无空格整段一个 token),zhparser 需自建
 * 扩展镜像——一期以 ILIKE 词项计分起步:空白/标点切词,CJK 连续段保留为整词,
 * 逐词 contains insensitive(见 unified-search.buildTermOr)。零迁移零扩展;
 * zhparser/pgvector 混合检索留实效实测后再评审(升级路径不变)。
 */

/** 检索词项上限(防超长 query 拖垮 OR 数组;超出部分丢弃) */
export const MAX_QUERY_TERMS = 8;

/** 单词项长度上限(防粘贴整段文本;CJK 粘连段整词截断) */
export const MAX_TERM_LEN = 32;

/**
 * 切词:trim → 小写 → 非「字母/数字」(含 CJK,\p{L} 涵盖汉字)替换为空格 →
 * 空白分割 → 截长 → 去重(保序)→ 截上限。空 q / 纯标点 → []。
 */
export function tokenizeQuery(q: string): string[] {
  const cleaned = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (cleaned === "") return [];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of cleaned.split(/\s+/)) {
    const term = raw.slice(0, MAX_TERM_LEN);
    if (term === "" || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= MAX_QUERY_TERMS) break;
  }
  return terms;
}
