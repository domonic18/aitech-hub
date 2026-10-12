/**
 * 联想词源插件(M25 任务A,方案 §3:词库 → 各搜索源 suggest 直拉 → 新词回灌):
 * Source 接口插件化,v1 bili + bing 两源,新增源实现接口即可。
 * 契约未经生产实证(批④ 真机验收确认),形状不对按单(源,词)失败跳过,不弃整轮。
 */
import { z } from "zod";

import { BiliApiUnavailableError } from "./bili/errors";
import { BILI_SUGGEST_GAP_MS } from "./constants";
import { randomGapMs, sleep } from "./timing";

export interface SuggestSource {
  /** 源标识,落 discovery_keyword.source(如 bili-suggest/bing-suggest) */
  id: string;
  /** 种子词的联想词(仅 trim;归一与去重在编排层) */
  fetch(seed: string): Promise<string[]>;
}

const TIMEOUT_MS = 10_000;

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Referer: "https://www.bilibili.com/",
};

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new BiliApiUnavailableError(`HTTP ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    throw new BiliApiUnavailableError("响应非 JSON");
  }
}

/** B站搜索联想(s.search.bilibili.com main/suggest;tag[].value) */
const biliSuggestSchema = z.object({
  code: z.number(),
  data: z
    .object({ tag: z.array(z.object({ value: z.string() })).optional() })
    .passthrough()
    .optional(),
});

export const biliSuggestSource: SuggestSource = {
  id: "bili-suggest",
  async fetch(seed) {
    const url = `https://s.search.bilibili.com/main/suggest?main_ver=v1&term=${encodeURIComponent(seed)}`;
    const parsed = biliSuggestSchema.safeParse(await getJson(url));
    if (!parsed.success) {
      throw new BiliApiUnavailableError("bili suggest 响应形态偏离契约");
    }
    return (parsed.data.data?.tag ?? []).map((t) => t.value.trim()).filter(Boolean);
  },
};

/** 必应联想(osjson OpenSearch 形态:[query, [terms]]);轻接口不打 B站 cookie */
const bingSuggestSchema = z.tuple([z.string(), z.array(z.string())]);

export const bingSuggestSource: SuggestSource = {
  id: "bing-suggest",
  async fetch(seed) {
    const url = `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(seed)}`;
    const parsed = bingSuggestSchema.safeParse(await getJson(url));
    if (!parsed.success) {
      throw new BiliApiUnavailableError("bing suggest 响应形态偏离契约");
    }
    return parsed.data[1].map((t) => t.trim()).filter(Boolean);
  },
};

/** v1 默认源序(bili 在前——主源语义;扩源在此追加) */
export const DEFAULT_SUGGEST_SOURCES: readonly SuggestSource[] = [
  biliSuggestSource,
  bingSuggestSource,
];

/** 单(源,词)拉取结果;失败隔离成 error 字段,编排层计数留痕 */
export interface SuggestYield {
  source: string;
  seed: string;
  suggestions: string[];
  error: string | null;
}

/** 逐源逐词直拉;每次调用后统一 ≥3s 随机间隔(源间/词间同规,constants 纪律) */
export async function fetchSuggestions(
  sources: readonly SuggestSource[],
  seeds: readonly string[],
): Promise<SuggestYield[]> {
  const yields: SuggestYield[] = [];
  for (const source of sources) {
    for (const seed of seeds) {
      try {
        const suggestions = await source.fetch(seed);
        yields.push({ source: source.id, seed, suggestions, error: null });
      } catch (e) {
        yields.push({
          source: source.id,
          seed,
          suggestions: [],
          error: e instanceof Error ? e.message : String(e),
        });
      }
      await sleep(randomGapMs(BILI_SUGGEST_GAP_MS));
    }
  }
  return yields;
}
