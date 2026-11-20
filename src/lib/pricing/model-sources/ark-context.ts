/**
 * 火山引擎方舟「模型列表」页 → 逐模型上下文窗口(伴生页·上下文出处)。
 *
 * 牌价页只给价与**输入长度阶梯**(阶梯上界可推上下文上限,但推不出官方口径
 * 的上下文窗口);官方逐模型的「上下文窗口: 1024K」在「模型列表」这一页的
 * 「长度限制(token)」列里。该页是 SSR 静态页,普通 fetch 即可取到。
 *
 * 取数失败**不连坐主源**(价照落,上下文留空显示「—」),但记日志不静默。
 */
import * as cheerio from "cheerio";

import type { SnapshotSink } from "../../collect/snapshot-capture";
import { logInfo } from "../../logger";
import { formatContextTokens, normalizeModelKey, parseContextTokens } from "../context";
import type { ModelPrefillRow } from "../crawlers";

/** 方舟「模型列表」文档(上下文出处;文档 id 固定,不走后台 URL 配置) */
export const VOLCENGINE_ARK_MODELS_URL = "https://www.volcengine.com/docs/82379/1330310";

/** 文档条目:上下文窗口 + 版本号(模型 id 尾部的 6 位日期,如 -260915) */
export interface ArkContextEntry {
  /** 上下文窗口原文口径(如 "1024K") */
  context: string;
  /** 版本号(越大越新;无日期为 0)——同名多版本取最新的那个 */
  version: number;
}

/** 文档模型 id 尾部的 6 位日期 → 版本号(无则 0) */
function versionOf(raw: string): number {
  const m = /(\d{6})/.exec(raw);
  return m === null ? 0 : Number(m[1]);
}

/**
 * 方舟「模型列表」页 → 归一模型 id → 上下文窗口。
 * 同一模型有多版本行(带日期后缀),取**最新版本**的上下文(旧版号会下线)。
 * 键同时收「行内模型 id」与「控制台详情链接里的 Id」(后者是不带日期的规范 id)。
 */
export function parseArkModelContexts(html: string): Map<string, ArkContextEntry> {
  const $ = cheerio.load(html);
  const map = new Map<string, ArkContextEntry>();
  const put = (key: string, entry: ArkContextEntry): void => {
    const prev = map.get(key);
    if (prev === undefined || entry.version > prev.version) map.set(key, entry);
  };
  $('[class*="ace-table-row"]').each((_, r) => {
    const cells = $(r)
      .find("[class*=ace-table-cell]")
      .map((_, c) =>
        $(c)
          .text()
          .replace(/\u200b/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .get();
    if (cells.length < 3) return;
    const m = /上下文窗口[:：]\s*([\d.]+)\s*([KM])/i.exec(cells[2] ?? "");
    if (m === null) return;
    const entry: ArkContextEntry = {
      context: `${m[1]}${(m[2] ?? "").toUpperCase()}`,
      version: versionOf(cells[0] ?? ""),
    };
    put(normalizeModelKey(cells[0] ?? ""), entry);
    const href = $(r)
      .find("a")
      .map((_, a) => $(a).attr("href") ?? "")
      .get()
      .find((h) => h.includes("Id="));
    if (href !== undefined) {
      put(normalizeModelKey(href.slice(href.indexOf("Id=") + 3)), entry);
    }
  });
  return map;
}

/**
 * 牌价行模型名 → 上下文窗口。行名与文档 id 形态不一(「doubao-seed-2.1-pro」
 * vs「doubao-seed-2-1-pro-260915」、「deepseek-v4-pro 正式版」vs
 * 「deepseek-v4-pro」),归一后精确匹配;匹配不上再按「文档 id 以行名开头」
 * 前缀兜底(取最新版本)。
 */
export function matchArkContext(
  modelKey: string,
  map: Map<string, ArkContextEntry>,
): string | null {
  const key = normalizeModelKey(modelKey);
  if (key === "") return null;
  const exact = map.get(key);
  if (exact !== undefined) return exact.context;
  let best: ArkContextEntry | null = null;
  for (const [docKey, entry] of map) {
    if (!docKey.startsWith(`${key}-`)) continue;
    if (best === null || entry.version > best.version) best = entry;
  }
  return best?.context ?? null;
}

/** 给牌价行补上下文窗口(token 计价行才补:图像/视频模型没有上下文概念) */
export function applyArkContexts(
  rows: ModelPrefillRow[],
  map: Map<string, ArkContextEntry>,
): ModelPrefillRow[] {
  return rows.map((r) => {
    if (r.priceUnit !== undefined && !r.priceUnit.startsWith("per_1")) return r;
    const context = matchArkContext(r.modelKey, map);
    if (context === null) return r;
    const tokens = parseContextTokens(context);
    if (tokens === null) return r;
    return { ...r, contextWindow: formatContextTokens(tokens) };
  });
}

/** 伴生页取数+解析(失败返回空表并记日志,不连坐主源) */
export async function fetchArkContextMap(
  sink?: SnapshotSink,
): Promise<Map<string, ArkContextEntry>> {
  try {
    const res = await fetch(VOLCENGINE_ARK_MODELS_URL, { cache: "no-store" });
    const html = await res.text();
    await sink?.({ tab: "models", html, httpStatus: res.status });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return parseArkModelContexts(html);
  } catch (e) {
    logInfo("pricing.source.context_fetch_failed", {
      source: "volcengine-ark",
      error: e instanceof Error ? e.message : String(e),
    });
    return new Map();
  }
}
