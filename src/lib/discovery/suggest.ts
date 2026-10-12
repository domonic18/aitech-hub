/**
 * 联想词源插件(M25 任务A,方案 §3:词库 → 各搜索源 suggest 直拉 → 新词回灌):
 * Source 接口插件化,v1 bili + bing 两源,新增源实现接口即可。
 * 契约批④ 真机实证(2026-10-12,首验两源全偏、按实证修正,形态见各 schema 注);
 * 形状不对按单(源,词)失败跳过,不弃整轮。
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

/** B站搜索联想(s.search.bilibili.com main/suggest;真机实证 2026-10-12:
 *  {exp_str, code:0, result:{tag:[{value,term,ref,name(带<em>),…}]}}——
 *  联想词在顶层 result,不在 data(tag 可缺省,产出即空) */
const biliSuggestSchema = z.object({
  code: z.number(),
  result: z
    .object({ tag: z.array(z.object({ value: z.string() })).optional() })
    .passthrough()
    .optional(),
});

export function parseBiliSuggest(payload: unknown): string[] {
  const parsed = biliSuggestSchema.safeParse(payload);
  if (!parsed.success) {
    throw new BiliApiUnavailableError("bili suggest 响应形态偏离契约");
  }
  return (parsed.data.result?.tag ?? []).map((t) => t.value.trim()).filter(Boolean);
}

export const biliSuggestSource: SuggestSource = {
  id: "bili-suggest",
  async fetch(seed) {
    const url = `https://s.search.bilibili.com/main/suggest?main_ver=v1&term=${encodeURIComponent(seed)}`;
    return parseBiliSuggest(await getJson(url));
  },
};

/** 必应联想(osjson 真机实证 2026-10-12:五元 [query, terms[], [], [], 相关度元数据];
 *  只取 [1] 词表,尾缀元素随版本增减故 rest 放行);轻接口不打 B站 cookie */
const bingSuggestSchema = z.tuple([z.string(), z.array(z.string())]).rest(z.unknown());

export function parseBingSuggest(payload: unknown): string[] {
  const parsed = bingSuggestSchema.safeParse(payload);
  if (!parsed.success) {
    throw new BiliApiUnavailableError("bing suggest 响应形态偏离契约");
  }
  return parsed.data[1].map((t) => t.trim()).filter(Boolean);
}

export const bingSuggestSource: SuggestSource = {
  id: "bing-suggest",
  async fetch(seed) {
    const url = `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(seed)}`;
    return parseBingSuggest(await getJson(url));
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
