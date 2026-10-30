/**
 * 厂商动态源注册表·代码侧真相源(M58 批②,data-expansion-plan §5.1):
 * - 取数形态/解析器/默认 URL 按 key 注册在本文件(改解析逻辑才发版);
 * - 渠道行落 crawl_source(type=vendor,config.vendorKey 路由),URL/启停/
 *   采集周期(默认半日)在 数据中心·源管理·采集渠道 后台可调零发版,
 *   与文字/牌价渠道同一套调度(tick 扫 due)/健康度/快照台账;
 * - 条目**不进电报流**:抓取后入事件抽取队列,抽取产物落 entity_event 并
 *   按 dedupeKey 作为 refId 入洞察信号池(source=vendor-<key>)。
 *
 * 首批六家(2026-10-30 真机探报告):OpenAI/Google AI/Qwen 有官方 RSS;
 * Anthropic/Kimi 列表页为服务端渲染(静态 HTML 可解析,未启 headless);
 * DeepSeek news 页为 Docusaurus SPA,取静态 sitemap(日期编码在 slug)。
 * Google DeepMind 无独立可达 feed,取 Google 官方 AI 分类 feed(含 DeepMind
 * 公告),vendor 记 Google——不凭厂商名假设来源。
 */
import { RateLimitedError } from "../../telegram/adapters/rss";
import type { InsightSource } from "../source-registry";

import {
  parseAnthropicNews,
  parseDeepseekSitemap,
  parseKimiBlog,
  parseVendorFeed,
  type VendorItem,
} from "./parse";

const CRAWLER_UA = "aitech-hub-crawler/0.1 (+https://17aitech.com)";
const FETCH_TIMEOUT_MS = 20_000;
/** 单源单轮条目上限(方案 §5.1:每源单轮 ≤20 条) */
export const VENDOR_MAX_ITEMS = 20;

export type VendorKind = "rss" | "html" | "sitemap";

export interface VendorDef {
  /** config.vendorKey 与 crawl_source.name=`vendor:<key>` 的 key */
  key: string;
  label: string;
  /** entity_event.vendor 落库值(稳定短标识,展示名由界面映射) */
  vendorName: string;
  insightSource: InsightSource;
  kind: VendorKind;
  defaultUrl: string;
  /** 列表原始文本 → 统一条目(纯函数,单测覆盖) */
  parse: (raw: string, baseUrl: string) => VendorItem[];
}

export const VENDOR_DEFS: VendorDef[] = [
  {
    key: "openai",
    label: "OpenAI 官方动态",
    vendorName: "OpenAI",
    insightSource: "vendor-openai",
    kind: "rss",
    defaultUrl: "https://openai.com/news/rss.xml",
    parse: parseVendorFeed,
  },
  {
    key: "anthropic",
    label: "Anthropic 官方动态",
    vendorName: "Anthropic",
    insightSource: "vendor-anthropic",
    kind: "html",
    defaultUrl: "https://www.anthropic.com/news",
    parse: parseAnthropicNews,
  },
  {
    key: "google",
    label: "Google AI 官方博客",
    vendorName: "Google",
    insightSource: "vendor-google",
    kind: "rss",
    defaultUrl: "https://blog.google/technology/ai/rss/",
    parse: parseVendorFeed,
  },
  {
    key: "deepseek",
    label: "DeepSeek 官方动态",
    vendorName: "DeepSeek",
    insightSource: "vendor-deepseek",
    kind: "sitemap",
    defaultUrl: "https://api-docs.deepseek.com/sitemap.xml",
    parse: parseDeepseekSitemap,
  },
  {
    key: "qwen",
    label: "Qwen 官方博客",
    vendorName: "Qwen",
    insightSource: "vendor-qwen",
    kind: "rss",
    defaultUrl: "https://qwenlm.github.io/blog/index.xml",
    parse: parseVendorFeed,
  },
  {
    key: "kimi",
    label: "Kimi 官方博客",
    vendorName: "Kimi",
    insightSource: "vendor-kimi",
    kind: "html",
    defaultUrl: "https://www.kimi.com/blog",
    parse: parseKimiBlog,
  },
];

/** config.vendorKey → def;未注册 key 返回 null(编排层抛错计源失败) */
export function resolveVendorDef(config: unknown): VendorDef | null {
  const key =
    typeof config === "object" && config !== null && "vendorKey" in config
      ? String((config as Record<string, unknown>).vendorKey)
      : "";
  return VENDOR_DEFS.find((d) => d.key === key) ?? null;
}

/** 拉取列表原文(快照与解析共用同一份文本);429 抛 RateLimitedError 交
 * crawlSource 顺延不记失败,其余非 2xx/超时抛错计源失败 */
export async function fetchVendorList(def: VendorDef, url: string): Promise<string> {
  void def;
  const res = await fetch(url, {
    headers: {
      "user-agent": CRAWLER_UA,
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 429) throw new RateLimitedError();
  if (!res.ok) throw new Error(`vendor feed HTTP ${res.status}`);
  return res.text();
}
