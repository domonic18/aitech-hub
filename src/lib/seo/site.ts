import { env } from "@/lib/env";

/** 站点对外 URL(无尾斜杠;canonical/sitemap/feed/llms/JSON-LD 的绝对地址基准) */
export function siteUrl(): string {
  return env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
}

/** 站内路径 → 绝对 URL */
export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
