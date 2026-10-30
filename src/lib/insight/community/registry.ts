/**
 * 社区需求语料源注册表·代码侧真相源(M58 批④,data-expansion-plan §7):
 * - 取数形态/解析器/默认 URL 按 key 注册在本文件(改逻辑才发版);
 * - 渠道行落 crawl_source(type=community,config.communityKey 路由),URL/启停/
 *   采集周期在 数据中心·源管理·采集渠道 后台可调零发版,与其它渠道同一套
 *   调度(tick 扫 due)/健康度/快照台账;
 * - 条目只入洞察信号池(source=community-<key>),不进电报流;
 * - 长尾运行参数(百度种子、GitHub 仓库白名单)走 config,后台「扩展配置」
 *   可改(种子缺省取站点标签 + 近期热搜词;仓库缺省两仓跑通全链)。
 *
 * 真机探报告(2026-10-30):
 * - HN Algolia:直连可达,`query=AI` 全文过滤后当日故事相关度高(多词 OR
 *   会退化成旧条目,单关键词最稳);
 * - V2EX:境内直连拒连,须经系统出口代理;`/api/topics/show.json` 节点
 *   openai/claude/deepseek/gemini 均 200(通用 hot.json 与 AI 无关,不用);
 * - 百度下拉:直连 200,响应为 GB18030 JSONP(须解码后再剥包裹);
 * - GitHub Issues:匿名 60 次/小时,两仓日频足够;PR 混在 issues 接口须剔除;
 * - Reddit:经代理仍 403(实测),本批不注册,待独立评估。
 */
import { RateLimitedError } from "../../telegram/adapters/rss";
import { fetchViaEgress } from "../../net/egress-fetch";
import type { InsightSource } from "../source-registry";
import {
  COMMUNITY_BAIDU_CHARSET,
  COMMUNITY_OSS_MAX_REPOS,
  COMMUNITY_V2EX_NODES,
  type CommunityKey,
} from "./constants";
import {
  parseBaiduSuggest,
  parseGithubIssues,
  parseHackerNews,
  parseV2ex,
  type CommunityItem,
} from "./parse";

const CRAWLER_UA = "aitech-hub-crawler/0.1 (+https://17aitech.com)";
const FETCH_TIMEOUT_MS = 20_000;

/** 采集上下文(config 投影;crawl 层组装,注册表不读库) */
export interface CommunityContext {
  /** 百度下拉种子(其余源忽略) */
  seeds: string[];
  /** GitHub 仓库白名单 owner/repo(其余源忽略) */
  repos: string[];
  /** GitHub token(可选;匿名限频 60 次/小时) */
  token: string | null;
}

export interface CommunityRaw {
  /** 快照 tab 兼解析路由:`feed` / `node:<name>` / `seed:<seed>` / `repo:<repo>` */
  tab: string;
  url: string;
  raw: string;
  httpStatus: number;
}

export interface CommunityDef {
  key: CommunityKey;
  label: string;
  insightSource: InsightSource;
  /** 端点基址(后台可改;多节点/多种子源在其上追加参数) */
  defaultUrl: string;
  /** 默认采集周期(分钟;源管理可调) */
  defaultIntervalMin: number;
  /** 取数是否必须经系统出口代理 */
  viaProxy: boolean;
  collect: (url: string, ctx: CommunityContext) => Promise<CommunityRaw[]>;
  parse: (raws: CommunityRaw[], now: Date) => CommunityItem[];
}

/** 取文本;429 → RateLimitedError(交 crawlSource 顺延不记失败) */
async function getText(
  url: string,
  opts: { viaProxy: boolean; accept: string; token?: string | null; charset?: string },
): Promise<{ raw: string; httpStatus: number }> {
  const headers: Record<string, string> = {
    "user-agent": CRAWLER_UA,
    accept: opts.accept,
  };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const init: RequestInit = { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) };
  const res = opts.viaProxy ? await fetchViaEgress(url, init) : await fetch(url, init);
  if (res.status === 429) throw new RateLimitedError();
  if (!res.ok) throw new Error(`community feed HTTP ${res.status} (${url})`);
  const raw =
    opts.charset === undefined
      ? await res.text()
      : new TextDecoder(opts.charset).decode(await res.arrayBuffer());
  return { raw, httpStatus: res.status };
}

/** tab 形如 `node:<name>` / `seed:<seed>` / `repo:<repo>` → 冒号后的键 */
function tabValue(raw: CommunityRaw, prefix: string): string {
  return raw.tab.startsWith(prefix) ? raw.tab.slice(prefix.length) : "";
}

export const COMMUNITY_DEFS: CommunityDef[] = [
  {
    key: "hn",
    label: "Hacker News",
    insightSource: "community-hn",
    defaultUrl: "https://hn.algolia.com/api/v1/search_by_date?tags=story&query=AI&hitsPerPage=10",
    defaultIntervalMin: 60,
    viaProxy: false,
    collect: async (url) => [
      {
        ...(await getText(url, { viaProxy: false, accept: "application/json" })),
        tab: "feed",
        url,
      },
    ],
    parse: (raws) => raws.flatMap((r) => parseHackerNews(r.raw)),
  },
  {
    key: "v2ex",
    label: "V2EX",
    insightSource: "community-v2ex",
    defaultUrl: "https://www.v2ex.com/api/topics/show.json",
    defaultIntervalMin: 60,
    viaProxy: true,
    collect: async (url) => {
      const out: CommunityRaw[] = [];
      for (const node of COMMUNITY_V2EX_NODES) {
        const u = new URL(url);
        u.searchParams.set("node_name", node);
        u.searchParams.set("page", "1");
        const target = u.toString();
        out.push({
          ...(await getText(target, { viaProxy: true, accept: "application/json" })),
          tab: `node:${node}`,
          url: target,
        });
      }
      return out;
    },
    parse: (raws) => raws.flatMap((r) => parseV2ex(r.raw)),
  },
  {
    key: "baidu",
    label: "百度下拉",
    insightSource: "community-baidu",
    defaultUrl: "https://suggestion.baidu.com/su",
    defaultIntervalMin: 1440,
    viaProxy: false,
    collect: async (url, ctx) => {
      const out: CommunityRaw[] = [];
      for (const seed of ctx.seeds) {
        const u = new URL(url);
        u.searchParams.set("wd", seed);
        u.searchParams.set("cb", "cb");
        const target = u.toString();
        const raw = await getText(target, {
          viaProxy: false,
          accept: "*/*",
          charset: COMMUNITY_BAIDU_CHARSET,
        });
        out.push({ ...raw, tab: `seed:${seed}`, url: target });
      }
      return out;
    },
    parse: (raws) => raws.flatMap((r) => parseBaiduSuggest(r.raw, tabValue(r, "seed:"))),
  },
  {
    key: "oss",
    label: "开源社区 Issues",
    insightSource: "community-oss",
    defaultUrl: "https://api.github.com",
    defaultIntervalMin: 1440,
    viaProxy: false,
    collect: async (url, ctx) => {
      const out: CommunityRaw[] = [];
      const base = url.replace(/\/+$/, "");
      for (const repo of ctx.repos.slice(0, COMMUNITY_OSS_MAX_REPOS)) {
        const target = `${base}/repos/${repo}/issues?state=open&sort=created&direction=desc&per_page=30`;
        const raw = await getText(target, {
          viaProxy: false,
          accept: "application/vnd.github+json",
          token: ctx.token,
        });
        out.push({ ...raw, tab: `repo:${repo}`, url: target });
      }
      return out;
    },
    parse: (raws, now) => raws.flatMap((r) => parseGithubIssues(r.raw, tabValue(r, "repo:"), now)),
  },
];

/** config.communityKey → def;未注册 key 返回 null(编排层抛错计源失败) */
export function resolveCommunityDef(config: unknown): CommunityDef | null {
  const key =
    typeof config === "object" && config !== null && "communityKey" in config
      ? String((config as Record<string, unknown>).communityKey)
      : "";
  return COMMUNITY_DEFS.find((d) => d.key === key) ?? null;
}
