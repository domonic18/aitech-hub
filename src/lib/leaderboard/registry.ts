/**
 * 榜单源注册表·代码侧真相源(M58 批③,data-expansion-plan §6.1):
 * - 取数形态/解析器/默认 URL 按 key 注册在本文件(改解析逻辑才发版);
 * - 渠道行落 crawl_source(type=leaderboard,config.boardKey 路由),URL/启停/
 *   采集周期(默认日频)在 数据中心·源管理·采集渠道 后台可调零发版;
 * - 每源固定一个榜单(board),条目不进电报流,落 insight_leaderboard_snapshot。
 *
 * 真机探报告(2026-10-30):
 * - Artificial Analysis:静态 HTML 内嵌 RSC 载荷,可直取,**无需 headless**;
 * - Hugging Face:公开 JSON API,境内直连不可达,须经系统出口代理(M33 单例);
 * - arXiv:export.arxiv.org Atom,直连可达;
 * - GitHub Trending:服务端渲染 HTML,直连可达;
 * - LMArena:**Cloudflare 人机校验 403**(带代理亦然),本批不做,待独立评估
 *   headless 成本与转载授权(方案 §12 开放决策 1)。
 */
import { fetchViaEgress } from "../net/egress-fetch";
import { RateLimitedError } from "../telegram/adapters/rss";
import type { LeaderboardEntityType } from "./constants";
import {
  parseArxivFeed,
  parseArtificialAnalysis,
  parseGithubTrending,
  parseHuggingFace,
  type LeaderboardItem,
} from "./parse";

const CRAWLER_UA = "aitech-hub-crawler/0.1 (+https://17aitech.com)";
const FETCH_TIMEOUT_MS = 30_000;

export interface LeaderboardDef {
  /** config.boardKey 与 crawl_source.name=`leaderboard:<key>` 的 key */
  key: string;
  label: string;
  /** 榜单展示名(公开页页签与署名区同源) */
  board: string;
  entityType: LeaderboardEntityType;
  defaultUrl: string;
  /** 取数是否必须经系统出口代理(境内直连不可达的源) */
  viaProxy: boolean;
  /** 原文 → 统一入榜条目(纯函数,单测覆盖) */
  parse: (raw: string, baseUrl: string) => LeaderboardItem[];
  /** 单轮入榜条数上限(缺省 LEADERBOARD_MAX_ITEMS=20)。
   * 智能指数扩到 60:M63 散点需要足够样本才看得出价格-能力分布 */
  maxItems?: number;
}

const ARXIV_API = "https://export.arxiv.org/api/query";

export const LEADERBOARD_DEFS: LeaderboardDef[] = [
  {
    key: "artificial-analysis",
    label: "Artificial Analysis 智能指数榜",
    board: "智能指数",
    entityType: "model",
    defaultUrl: "https://artificialanalysis.ai/leaderboards/models",
    viaProxy: false,
    parse: parseArtificialAnalysis,
    maxItems: 60,
  },
  {
    key: "huggingface",
    label: "Hugging Face 趋势榜",
    board: "模型趋势",
    entityType: "model",
    defaultUrl: "https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=50",
    viaProxy: true,
    parse: parseHuggingFace,
  },
  {
    key: "arxiv-cs-ai",
    label: "arXiv cs.AI 最新论文",
    board: "cs.AI 最新",
    entityType: "paper",
    defaultUrl: `${ARXIV_API}?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=50`,
    viaProxy: false,
    parse: parseArxivFeed,
  },
  {
    key: "arxiv-cs-cl",
    label: "arXiv cs.CL 最新论文",
    board: "cs.CL 最新",
    entityType: "paper",
    defaultUrl: `${ARXIV_API}?search_query=cat:cs.CL&sortBy=submittedDate&sortOrder=descending&max_results=50`,
    viaProxy: false,
    parse: parseArxivFeed,
  },
  {
    key: "github",
    label: "GitHub Trending 日榜",
    board: "热门仓库",
    entityType: "repo",
    defaultUrl: "https://github.com/trending?since=daily",
    viaProxy: false,
    parse: parseGithubTrending,
  },
];

/** config.boardKey → def;未注册 key 返回 null(编排层抛错计源失败) */
export function resolveLeaderboardDef(config: unknown): LeaderboardDef | null {
  const key =
    typeof config === "object" && config !== null && "boardKey" in config
      ? String((config as Record<string, unknown>).boardKey)
      : "";
  return LEADERBOARD_DEFS.find((d) => d.key === key) ?? null;
}

/** 拉取榜单原文(快照与解析共用同一份文本)。viaProxy 源读系统出口代理单例:
 * 启用即走代理,未配置退回直连(失败如实计源错误,不假装成功)。 */
export async function fetchLeaderboardList(def: LeaderboardDef, url: string): Promise<string> {
  const init: RequestInit = {
    headers: { "user-agent": CRAWLER_UA, accept: "*/*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  };
  const res = def.viaProxy ? await fetchViaEgress(url, init) : await fetch(url, init);
  if (res.status === 429) throw new RateLimitedError();
  if (!res.ok) throw new Error(`leaderboard feed HTTP ${res.status}`);
  return res.text();
}
