/**
 * 爬虫 UA 分类(2026-10-07 站点统计「人机区分」需求,方案B):
 * 已知 AI 爬虫与搜索引擎爬虫的 UA 指纹 → 名字 + 类别。middleware 在边缘侧
 * 调 classifyBotUa 识别页面抓取,经内部端点缓冲进 stats_referrer_daily
 * (source_class='bot'),与真人四分类(direct/search/referral/ai)分账展示。
 * 边缘环境安全:零 import(勿引 classify.ts——其 node:crypto 不可入 middleware)。
 * 只认名单内指纹,未识别 UA 一律 null(宁缺勿滥,不与 isBotUa 的人类管道闸门混用)。
 */

export type BotKind = "ai" | "search";

export interface ClassifiedBot {
  name: string;
  kind: BotKind;
}

/**
 * 指纹表:顺序即优先级(先 AI 后搜索;同厂商细粒度在前——Applebot-Extended 先于
 * Applebot)。name 是入库 source_name 与后台展示名,保持稳定勿改名(改了断历史序列)。
 */
const BOT_SIGNATURES: ReadonlyArray<[RegExp, string, BotKind]> = [
  // ── AI 训练/检索爬虫(GEO 观测核心)──
  [/GPTBot/i, "GPTBot", "ai"],
  [/OAI-SearchBot/i, "OAI-SearchBot", "ai"],
  [/ChatGPT-User/i, "ChatGPT-User", "ai"],
  [/ClaudeBot|Claude-Web/i, "ClaudeBot", "ai"],
  [/Claude-User|Claude-Search|anthropic-ai/i, "Claude-User", "ai"],
  [/PerplexityBot|Perplexity-User/i, "PerplexityBot", "ai"],
  [/Google-Extended/i, "Google-Extended", "ai"],
  [/Applebot-Extended/i, "Applebot-Extended", "ai"],
  [/meta-externalagent|FacebookBot|meta-webindexer/i, "meta-externalagent", "ai"],
  [/Bytespider/i, "Bytespider", "ai"],
  [/Amazonbot/i, "Amazonbot", "ai"],
  [/CCBot/i, "CCBot", "ai"],
  [/cohere-ai/i, "cohere-ai", "ai"],
  [/YouBot/i, "YouBot", "ai"],
  [/Diffbot/i, "Diffbot", "ai"],
  [/DeepSeekBot|deepseek/i, "DeepSeekBot", "ai"],
  // ── 搜索引擎爬虫(SEO 收录观测)──
  [/Googlebot/i, "Googlebot", "search"],
  [/bingbot|BingPreview/i, "bingbot", "search"],
  [/Baiduspider/i, "Baiduspider", "search"],
  [/Sogou.*(spider|bot)|SogouPushSpider/i, "Sogou", "search"],
  [/360Spider|HaoSouSpider/i, "360", "search"],
  [/YisouSpider|MiuiBot/i, "Yisou", "search"],
  [/PetalBot/i, "PetalBot", "search"],
  [/Applebot/i, "Applebot", "search"],
  [/YandexBot/i, "YandexBot", "search"],
  [/DuckDuckBot|DuckDuckGo-Favicons-Bot/i, "DuckDuckBot", "search"],
  [/\bYeti\//i, "Naver", "search"],
];

/** 爬虫 UA → 名字+类别;未识别返回 null(不计入,宁缺勿滥) */
export function classifyBotUa(ua: string | null | undefined): ClassifiedBot | null {
  if (!ua) return null;
  for (const [re, name, kind] of BOT_SIGNATURES) {
    if (re.test(ua)) return { name, kind };
  }
  return null;
}

/** 已入库 bot 名 → 类别(展示侧分组用;未知名落 other,防名单改名后渲染崩) */
export function botKindOf(name: string): BotKind | "other" {
  const hit = BOT_SIGNATURES.find(([, n]) => n === name);
  return hit ? hit[2] : "other";
}
