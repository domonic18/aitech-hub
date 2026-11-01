/**
 * 首页搜索建议词装配(M70,server-only):后台可勾选固定词(`site_config
 * home.search_terms`,见 lib/config/site-config),未勾满时用洞察中心关键词云
 * 自动补齐到 count(3-4);云无数据时回退内置示例词。
 *
 * 客户端红线:HeroConsole 是客户端组件,本模块链到 prisma(经 insight/hotboard),
 * 数据只能由首页 RSC 取好后经 props 下传;后台表单同理只 import type。
 */
import { SEARCH_TERM_WORD_MAX, SEARCH_TERMS_MAX_WORDS } from "../constants";
import { insightKeywordCloud } from "../insight/hotboard";
import { prerenderSafe } from "../prerender-safe";
import type { HomeSearchTermsConfig } from "./site-config";

export interface HomeSearchTerm {
  icon: string;
  label: string;
  /** 搜索词(点击进 /search?q=) */
  q: string;
}

/** 内置兜底词(M70 前 HeroConsole 的硬编码清单;洞察云无数据时保底) */
export const DEFAULT_HOME_SEARCH_CHIPS: HomeSearchTerm[] = [
  { icon: "i-fire", label: "Claude Code 实战", q: "Claude Code" },
  { icon: "i-book", label: "MCP 入门到实战", q: "MCP" },
  { icon: "i-tool", label: "本地部署 LLM", q: "本地部署" },
];

/** chip 图标轮换序(SiteSprite 已注册;只做视觉区分,无语义) */
const CHIP_ICONS = ["i-fire", "i-book", "i-tool", "i-thunderbolt"] as const;

/** 自动取词主窗口:与关键词云同口径(近 7 天已打标簇) */
const PRIMARY_WINDOW_DAYS = 7;
/** 主窗口无数据时的兜底窗口(打标任务停摆/数据稀疏时仍能出词) */
const FALLBACK_WINDOW_DAYS = 30;
/** 候选/自动词取数上限(关键词云按机会分降序) */
const CLOUD_FETCH_LIMIT = 20;

/** 单字词无语义区分度,超长词撑爆 chip 宽度 —— 与洞察关键词云最短长度口径对齐 */
function isValidSearchWord(word: string): boolean {
  return word.length >= 2 && word.length <= SEARCH_TERM_WORD_MAX;
}

/**
 * 选词(纯函数):固定词按配置顺序打头,不足 count 时用自动热词补齐;
 * 去重(大小写不敏感)、跳过非法词、总数不超过 count 与 4。
 */
export function pickHomeSearchTerms(
  pinned: string[],
  autoWords: string[],
  count: number,
): string[] {
  const picked: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string): void => {
    if (picked.length >= count || picked.length >= SEARCH_TERMS_MAX_WORDS) return;
    const word = raw.trim();
    if (!isValidSearchWord(word)) return;
    const key = word.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    picked.push(word);
  };
  for (const word of pinned) push(word);
  for (const word of autoWords) push(word);
  return picked;
}

/** 单窗口取词(构建期无库 → 空数组,不阻断首页预渲染) */
async function cloudWords(days: number): Promise<string[]> {
  const words = await prerenderSafe(`home.search_terms.cloud.${days}d`, [], () =>
    insightKeywordCloud({ windowDays: days, limit: CLOUD_FETCH_LIMIT }),
  );
  return words.map((w) => w.word).filter(isValidSearchWord);
}

/**
 * 后台候选词:7 天窗口优先;不足 20 个时并入 30 天窗口(追加未出现词)。
 * 后台设置页 force-dynamic,每次打开现算。
 */
export async function listHomeSearchTermCandidates(): Promise<string[]> {
  const fresh = await cloudWords(PRIMARY_WINDOW_DAYS);
  const wide = fresh.length >= CLOUD_FETCH_LIMIT ? [] : await cloudWords(FALLBACK_WINDOW_DAYS);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const word of [...fresh, ...wide]) {
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(word);
    if (merged.length >= CLOUD_FETCH_LIMIT) break;
  }
  return merged;
}

/** 首页 chips(服务端装配):固定词打头 + 自动补齐;全空回退内置 */
export async function resolveHomeSearchTerms(
  cfg: HomeSearchTermsConfig,
): Promise<HomeSearchTerm[]> {
  return prerenderSafe("home.search_terms", DEFAULT_HOME_SEARCH_CHIPS, async () => {
    // 固定词已够数 → 不查词云(高频 ISR 再生时省两次查询)
    let words = pickHomeSearchTerms(cfg.words, [], cfg.count);
    if (words.length < cfg.count) {
      const auto = await listHomeSearchTermCandidates();
      words = pickHomeSearchTerms(cfg.words, auto, cfg.count);
    }
    if (words.length === 0) return DEFAULT_HOME_SEARCH_CHIPS;
    return words.map((word, i) => ({
      icon: CHIP_ICONS[i % CHIP_ICONS.length]!,
      label: word,
      q: word,
    }));
  });
}
