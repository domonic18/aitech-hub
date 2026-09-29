/**
 * 统计采集纯函数(requirement §3.5 口径):bot 识别、来源四分类
 * (direct/search/referral/ai,AI 助手单独类目是 GEO 核心观测)、
 * 访客环境解析、UV 匿名哈希(只存哈希,不存明文 IP)。
 * 无 IO,单测主战场;日界口径见 lib/datetime.ts。
 */
import { createHash } from "node:crypto";

export type SourceClass = "direct" | "search" | "referral" | "ai";

export interface ClassifiedReferrer {
  sourceClass: SourceClass;
  sourceName: string;
}

export interface ClientEnv {
  browser: string;
  os: string;
  deviceType: "desktop" | "mobile" | "tablet";
}

const SEARCH_ENGINES: Array<[RegExp, string]> = [
  [/google\./i, "google"],
  [/bing\./i, "bing"],
  [/baidu\.com/i, "baidu"],
  [/sogou\.com/i, "sogou"],
  [/\bso\.com$/i, "360"],
  [/sm\.cn$/i, "shenma"],
  [/duckduckgo\./i, "duckduckgo"],
  [/yahoo\./i, "yahoo"],
  [/yandex\./i, "yandex"],
];

/** AI 助手来源(GEO 战略观测项);host 匹配,先于搜索引擎判定(gemini.google.com 等) */
const AI_ASSISTANTS: Array<[RegExp, string]> = [
  [/chatgpt\.com$|openai\.com$/i, "chatgpt"],
  [/perplexity\.ai$/i, "perplexity"],
  [/claude\.ai$|anthropic\.com$/i, "claude"],
  [/gemini\.google\.com$/i, "gemini"],
  [/copilot\.microsoft\.com$/i, "copilot"],
  [/kimi\.com$|moonshot\.cn$/i, "kimi"],
  [/doubao\.com$/i, "doubao"],
  [/yuanbao\.tencent\.com$/i, "yuanbao"],
  [/poe\.com$/i, "poe"],
  [/grok\.com$|x\.ai$/i, "grok"],
  [/deepseek\.com$/i, "deepseek"],
];

/** 已知爬虫/预览器/工具客户端:不计入统计(requirement §6 去爬虫口径) */
const BOT_UA_RE =
  /(bot|crawler|spider|slurp|curl|wget|python-requests|python-urllib|go-http-client|java\/|okhttp|libwww|httpclient|scrapy|headless|puppeteer|playwright|phantomjs|lighthouse|pagespeed|bytespider|bingpreview|facebookexternalhit|yandexbot|duckduckbot|monitor|uptime|preview)/i;

export function isBotUa(ua: string | null | undefined): boolean {
  if (!ua || !ua.trim()) return true; // 无 UA 按非浏览器处理
  return BOT_UA_RE.test(ua);
}

export function classifyReferrer(referrer: string | null | undefined): ClassifiedReferrer {
  if (!referrer || !referrer.trim()) return { sourceClass: "direct", sourceName: "none" };
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return { sourceClass: "direct", sourceName: "none" };
  }
  for (const [re, name] of AI_ASSISTANTS) {
    if (re.test(host)) return { sourceClass: "ai", sourceName: name };
  }
  for (const [re, name] of SEARCH_ENGINES) {
    if (re.test(host)) return { sourceClass: "search", sourceName: name };
  }
  return { sourceClass: "referral", sourceName: host.slice(0, 50) };
}

export function parseClient(ua: string): ClientEnv {
  const browser = (() => {
    if (/micromessenger/i.test(ua)) return "WeChat";
    if (/edg\//i.test(ua)) return "Edge";
    if (/opr\/|opera/i.test(ua)) return "Opera";
    if (/firefox\//i.test(ua)) return "Firefox";
    if (/chrome\//i.test(ua)) return "Chrome";
    if (/safari\//i.test(ua)) return "Safari";
    if (/msie|trident/i.test(ua)) return "IE";
    return "Other";
  })();
  const os = (() => {
    if (/windows/i.test(ua)) return "Windows";
    if (/android/i.test(ua)) return "Android";
    if (/iphone|ipod/i.test(ua)) return "iOS";
    if (/ipad|tablet/i.test(ua)) return "iPadOS";
    if (/mac os x|macintosh/i.test(ua)) return "macOS";
    if (/linux/i.test(ua)) return "Linux";
    return "Other";
  })();
  const deviceType: ClientEnv["deviceType"] = /ipad|tablet/i.test(ua)
    ? "tablet"
    : /mobi|android|iphone/i.test(ua)
      ? "mobile"
      : "desktop";
  return { browser, os, deviceType };
}

/**
 * UV 匿名标识:sha256(盐 + IP + UA) 十六进制前 32 位。
 * 盐复用 AUTH_SECRET(密钥仅 env);结果不可逆,满足"不存明文 IP"约束。
 */
export function visitorHash(salt: string, ip: string, ua: string): string {
  return createHash("sha256").update(`${salt}:view:${ip}:${ua}`).digest("hex").slice(0, 32);
}

/** 页面路径规整:仅留路径、去查询串、限长(表上限 500) */
export function normalizePagePath(rawPath: string): string {
  const path = rawPath.split(/[?#]/)[0];
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized.slice(0, 500);
}
