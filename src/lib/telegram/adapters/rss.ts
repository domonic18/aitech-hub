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

/** 拉取并解析 feed;HTTP 非 2xx 或超时抛错(交 ingest 记来源连续失败) */
export async function fetchRssItems(
  url: string,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<AdapterItem[]> {
  const res = await fetch(url, {
    headers: {
      "user-agent": CRAWLER_UA,
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
  return parseFeed(await res.text());
}
