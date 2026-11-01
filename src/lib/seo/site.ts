import { env } from "@/lib/env";

/** 站点对外 URL(无尾斜杠;canonical/sitemap/feed/llms/JSON-LD 的绝对地址基准) */
export function siteUrl(): string {
  return env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
}

/** 站内路径 → 绝对 URL */
export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/** 部署域名(页头品牌 chip 右侧的 tld / llms.txt 标题行);随 NEXT_PUBLIC_SITE_URL,dev 即 localhost。
 *  住这里而非 lib/site-meta:后者必须零 import(客户端链上),见该文件头注。 */
export function siteHost(): string {
  return new URL(siteUrl()).host;
}
