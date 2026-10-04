/**
 * RSS/Atom 适配器(M7 批③b):拉取 feed 解析为统一条目。
 * 解析用 fast-xml-parser(用户选型),RSS 2.0 与 Atom 双格式;
 * 本层只做格式转换——URL 规范化/去重/过滤在 ingest 编排层,职责不混。
 */
import { XMLParser } from "fast-xml-parser";

/** 采集条目统一形态(各适配器输出;title/url 必有,缺失的条目整条丢弃) */
export interface AdapterItem {
  title: string;
  url: string;
  publishedAt: Date | null;
  summaryCandidate: string;
}

const CRAWLER_UA = "aitech-hub-crawler/0.1 (+https://17aitech.com)";
const FETCH_TIMEOUT_MS = 15_000;

/** 供应方限频(HTTP 429):ingest 特判不记失败,顺延下轮(渠道健康性不受影响) */
export class RateLimitedError extends Error {
  constructor() {
    super("feed rate limited (HTTP 429)");
    this.name = "RateLimitedError";
  }
}

/** token 鉴权 feed 的凭证容器(值来自 crawl_source.config,不落日志/错误信息) */
export interface RssFetchConfig {
  token?: string;
  timeoutMs?: number;
}

/** 凭证以 query 注入(机器之心 MCP 应用端点模式);非法 URL 原样返回交上层报错 */
export function applyToken(raw: string, token?: string): string {
  if (!token) return raw;
  try {
    const u = new URL(raw);
    u.searchParams.set("token", token);
    return u.toString();
  } catch {
    return raw;
  }
}

const PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

type XmlNode = Record<string, unknown>;

/** fast-xml-parser 值取文本:string 直接取,带属性节点取 #text */
function asText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && v !== null) {
    const text = (v as XmlNode)["#text"];
    if (typeof text === "string") return text.trim();
  }
  return "";
}

/** 同名节点单/多归一(fast-xml-parser 单子节点不返回数组) */
function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function toDate(v: unknown): Date | null {
  const s = asText(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Atom link 取 href:优先无 rel 或 rel=alternate,否则首个带 href 的 */
function atomEntryUrl(entry: XmlNode): string {
  let fallback = "";
  for (const link of asArray(entry["link"] as XmlNode | XmlNode[] | undefined)) {
    const href = typeof link["@_href"] === "string" ? link["@_href"] : "";
    if (!href) continue;
    const rel = typeof link["@_rel"] === "string" ? link["@_rel"] : "";
    if (rel === "" || rel === "alternate") return href;
    if (!fallback) fallback = href;
  }
  return fallback;
}

function mapRssItem(item: XmlNode): AdapterItem | null {
  const title = asText(item["title"]);
  const link = asText(item["link"]);
  const guid = asText(item["guid"]);
  const url = link.startsWith("http") ? link : guid.startsWith("http") ? guid : "";
  if (!title || !url) return null;
  return {
    title,
    url,
    publishedAt: toDate(item["pubDate"]),
    summaryCandidate: asText(item["description"]) || asText(item["content:encoded"]),
  };
}

function mapAtomEntry(entry: XmlNode): AdapterItem | null {
  const title = asText(entry["title"]);
  const url = atomEntryUrl(entry);
  if (!title || !url) return null;
  return {
    title,
    url,
    publishedAt: toDate(entry["updated"]) ?? toDate(entry["published"]),
    summaryCandidate: asText(entry["summary"]) || asText(entry["content"]),
  };
}

/** 解析 RSS 2.0 / Atom XML 文本为条目;两格式都无条目视为异常交上层计失败 */
export function parseFeed(xml: string): AdapterItem[] {
  const doc = PARSER.parse(xml) as XmlNode;

  const rss = doc["rss"] as XmlNode | undefined;
  const channel = asArray(rss?.channel as XmlNode | XmlNode[] | undefined)[0];
  const items = asArray(channel?.item as XmlNode | XmlNode[] | undefined);
  if (items.length > 0) {
    return items.map(mapRssItem).filter((it): it is AdapterItem => it !== null);
  }

  const atom = doc["feed"] as XmlNode | undefined;
  return asArray(atom?.entry as XmlNode | XmlNode[] | undefined)
    .map(mapAtomEntry)
    .filter((it): it is AdapterItem => it !== null);
}

/** 拉取并解析 feed;429 抛 RateLimitedError,其余非 2xx/超时抛错(交 ingest 记连续失败) */
export async function fetchRssItems(
  url: string,
  config: RssFetchConfig = {},
): Promise<AdapterItem[]> {
  const res = await fetch(applyToken(url, config.token), {
    headers: {
      "user-agent": CRAWLER_UA,
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(config.timeoutMs ?? FETCH_TIMEOUT_MS),
  });
  if (res.status === 429) throw new RateLimitedError();
  if (!res.ok) throw new Error(`feed HTTP ${res.status}`); // 错误信息不含 URL——token 不外泄
  return parseFeed(await res.text());
}
