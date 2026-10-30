/**
 * 厂商动态列表解析(M58 批②,纯函数可单测):三种取数形态 → 统一条目。
 * - rss:RSS 2.0 / Atom(fast-xml-parser,复用电报适配器解析器);
 * - html:服务端渲染的列表页按卡片正则取(title/url/摘要/日期);
 * - sitemap:静态 sitemap.xml 取 /news/ 文章(日期编码在 slug,标题留空由抽取
 *   阶段抓正文补齐)。
 * 只做格式转换——去重/入库/抽取在 crawl.ts / extract.ts;解析不出条目视为
 * 契约漂移,由上游计源失败(不静默空跑)。
 */
import { parseFeed } from "../../telegram/adapters/rss";
import { canonicalUrl, decodeHtmlEntities, stripHtml } from "../../telegram/normalize";

export interface VendorItem {
  title: string;
  url: string;
  publishedAt: Date | null;
  /** 列表页可得的摘要(正文抓取兜底前的最佳输入) */
  summary: string;
}

function absolute(base: string, href: string): string {
  try {
    return canonicalUrl(new URL(href, base).toString());
  } catch {
    return "";
  }
}

function normalizeItems(items: VendorItem[]): VendorItem[] {
  const seen = new Set<string>();
  const out: VendorItem[] = [];
  for (const it of items) {
    if (it.url === "" || seen.has(it.url)) continue;
    seen.add(it.url);
    out.push(it);
  }
  return out;
}

/** 统一按发布日倒序(无日期保持原序排在最后):feed/列表升序不一,
 * 截断单轮上限前必须归一,否则旧 feed 会把最新条目挤出窗口 */
export function sortVendorItems(items: VendorItem[]): VendorItem[] {
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const at = a.it.publishedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
      const bt = b.it.publishedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
      return at !== bt ? bt - at : a.i - b.i;
    })
    .map((x) => x.it);
}

/** RSS/Atom → 条目(摘要走 stripHtml 清洗,与电报入库同口径) */
export function parseVendorFeed(xml: string, baseUrl: string): VendorItem[] {
  return normalizeItems(
    parseFeed(xml).map((it) => ({
      title: it.title,
      url: absolute(baseUrl, it.url),
      publishedAt: it.publishedAt,
      summary: stripHtml(it.summaryCandidate),
    })),
  );
}

/** Anthropic 新闻列表(服务端渲染):卡片 = article.W1FydW_tile / W1FydW_featured,
 * 标题在 tileLink 内的 h2(featured)/h3(tile),摘要 featuredSummary/summary,
 * header <time> 日期。**按卡片 class 定界而非裸 <article>**:页面外层还有
 * article 包裹层,非贪婪匹配会跨卡截断(真机实测 7 卡只出 2 条)。
 * href 不限定 /news/:模型发布页在顶级 slug(/claude-opus-5-5)、研究页在
 * /research/,只排除站外与页内锚点。 */
export function parseAnthropicNews(html: string, baseUrl: string): VendorItem[] {
  const items: VendorItem[] = [];
  for (const m of html.matchAll(
    /<article class="W1FydW_(?:tile|featured)"[^>]*>([\s\S]*?)<\/article>/g,
  )) {
    const block = m[1];
    const href = /W1FydW_tileLink[^>]*href="([^"]+)"/.exec(block)?.[1];
    if (href === undefined || !href.startsWith("/") || href.startsWith("//")) continue;
    const title = stripHtml(
      /<h[1-6][^>]*W1FydW_(?:featuredTitle|tileTitle)[^>]*>([\s\S]*?)<\/h[1-6]>/.exec(block)?.[1] ??
        "",
    );
    if (title === "") continue;
    const summary = stripHtml(
      /W1FydW_(?:featuredSummary|summary)[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1] ?? "",
    );
    const timeText = /<time>([^<]+)<\/time>/.exec(block)?.[1] ?? "";
    items.push({
      title,
      url: absolute(baseUrl, href),
      publishedAt: parseMonthDayYear(timeText),
      summary,
    });
  }
  return normalizeItems(items);
}

/** Kimi 博客列表(服务端渲染):<a href="/blog/<slug>">标题</a>;列表无日期 */
export function parseKimiBlog(html: string, baseUrl: string): VendorItem[] {
  const items: VendorItem[] = [];
  for (const m of html.matchAll(/<a[^>]*href="(\/blog\/[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const title = stripHtml(decodeHtmlEntities(m[2]));
    if (title === "") continue;
    items.push({
      title,
      url: absolute(baseUrl, m[1]),
      publishedAt: null,
      summary: "",
    });
  }
  return normalizeItems(items);
}

/** DeepSeek sitemap:静态 XML 列出 /news/ 文章,slug 编码发布日期
 * (newsYYMMDD 六位;早期 newsMMDD 四位,年份按 2025 兜底) */
export function parseDeepseekSitemap(xml: string, baseUrl: string): VendorItem[] {
  const items: VendorItem[] = [];
  for (const m of xml.matchAll(/<loc>\s*([^<]*\/news\/news\d{4,6})\s*<\/loc>/g)) {
    const url = absolute(baseUrl, m[1]);
    if (url === "") continue;
    items.push({ title: "", url, publishedAt: newsSlugDate(m[1]), summary: "" });
  }
  return sortVendorItems(normalizeItems(items));
}

/** newsYYMMDD → Date(UTC);四位 newsMMDD 归 2025 年(DeepSeek 建站年) */
function newsSlugDate(loc: string): Date | null {
  const m = /\/news\/news(\d{4,6})$/.exec(loc);
  if (m === null) return null;
  const digits = m[1];
  if (digits.length === 6) {
    const yy = Number(digits.slice(0, 2));
    const mm = Number(digits.slice(2, 4));
    const dd = Number(digits.slice(4, 6));
    return validDate(2000 + yy, mm, dd);
  }
  return validDate(2025, Number(digits.slice(0, 2)), Number(digits.slice(2, 4)));
}

function validDate(year: number, month: number, day: number): Date | null {
  const d = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

/** "Oct 26, 2026" → Date(UTC);解析失败 null */
export function parseMonthDayYear(text: string): Date | null {
  const m = /([A-Z][a-z]{2})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/.exec(text.trim());
  if (m === null) return null;
  const month = MONTHS.indexOf(m[1]);
  if (month < 0) return null;
  return validDate(Number(m[3]), month + 1, Number(m[2]));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
