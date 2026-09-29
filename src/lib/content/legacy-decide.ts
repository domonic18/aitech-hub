/**
 * legacy 映射的纯决策部分(单测钉死,06 文档 §2.5):
 * 命中 301 / target NULL → 410 / 未命中 → 404。查表与缓存见 legacy.ts。
 */
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

/** 路径段数组 → 表内 oldPath 形态(各段经 normalizeSlug,红线 04 文档 §3) */
export function buildLegacyPath(segments: string[]): string {
  return `/${segments.map((s) => normalizeSlug(s)).join("/")}/`;
}
