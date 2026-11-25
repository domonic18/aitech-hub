/**
 * legacy 映射的纯决策部分(单测钉死,standard/01-testing §2.5):
 * 命中 301 / target NULL → 410 / 未命中 → 404。查表与缓存见 legacy.ts。
 */
import { isBigIntId } from "@/lib/http/parse-id";
import { normalizeSlug } from "@/lib/slug";

export interface LegacyHit {
  targetUrl: string | null;
  httpStatus: number;
}

/** "miss" 未命中映射表;LegacyHit 里 targetUrl=null 表示弃用(410) */
export type LegacyLookup = LegacyHit | "miss";

export function decideLegacy(lookup: LegacyLookup): "redirect" | "gone" | "notfound" {
  if (lookup === "miss") return "notfound";
  return lookup.targetUrl === null ? "gone" : "redirect";
}

/** 路径段数组 → 表内 oldPath 形态(各段经 normalizeSlug,红线 arch/07-frontend §3) */
export function buildLegacyPath(segments: string[]): string {
  return `/${segments.map((s) => normalizeSlug(s)).join("/")}/`;
}

/** 旧 WP query 形态 /?p=<wpId> 的承接命中行(id 序列化字符串,BigInt 不进 JSON) */
export interface WpPostHit {
  id: string;
  slug: string | null;
  status: string;
}

export type WpPostLookup = WpPostHit | "miss";

/** 已发布 → 301 文章页;草稿/软删/未命中(弃用资讯) → 410,一律不给爬虫重试理由 */
export function decideWpPost(lookup: WpPostLookup): "redirect" | "gone" {
  return lookup !== "miss" && lookup.status === "published" ? "redirect" : "gone";
}

/** /?p= 参数 → middleware rewrite 目标(地址栏不动,由 /legacy 路由查库给 301/410);非合法 id → null 放行 */
export function wpQueryTarget(p: string | null): string | null {
  return p !== null && isBigIntId(p) ? `/legacy/wp-p/${p}/` : null;
}
