/**
 * GEO 机器面分类(2026-10-09 方案A,GEO 统计):机器专属入口路径 → 面别。
 * 三个面:llms.txt 索引 / llms-full(-N).txt 全文分片 / 文章 .md 直出
 * (/post/<id>-<slug>.md,rewrite 形态,middleware 在 rewrite 前看到原始路径)。
 * 边缘环境安全:仅依赖零 IO 纯函数(同 bots.ts 纪律,勿引 node:crypto 系模块)。
 * 路径正则与 next.config rewrites 同口径(小写、大小写敏感)——大写形态会 404,
 * 不入账免得统计到死链。GEO 面任何 UA 都入账(长尾 Agent 不可枚举),未识别
 * UA 由端点侧记 GEO_UNKNOWN_AGENT。
 */

import { parsePostSegment } from "@/lib/content/post-path";

export type GeoSurface = "llms_index" | "llms_full" | "post_md";

/** 未识别 UA 在 GEO 面的记账名(名单内爬虫用 bots.ts 稳定名) */
export const GEO_UNKNOWN_AGENT = "unknown-agent";

const LLMS_INDEX_RE = /^\/llms\.txt$/;
const LLMS_FULL_RE = /^\/llms-full(?:-\d+)?\.txt$/;
const POST_MD_RE = /^\/post\/[^/]+\.md$/;

/** GEO 机器面路径 → 面别;非 GEO 路径 null(容忍尾斜杠,middleware 侧已去重) */
export function classifyGeoSurface(barePath: string): GeoSurface | null {
  const p = barePath.length > 1 && barePath.endsWith("/") ? barePath.slice(0, -1) : barePath;
  if (LLMS_INDEX_RE.test(p)) return "llms_index";
  if (LLMS_FULL_RE.test(p)) return "llms_full";
  if (POST_MD_RE.test(p)) return "post_md";
  return null;
}

/** 后台展示名(与路径形态一一对应,中文标签) */
export const GEO_SURFACE_LABELS: Record<GeoSurface, string> = {
  llms_index: "llms.txt 索引",
  llms_full: "llms-full 全文",
  post_md: "文章 Markdown",
};

/** 缓冲字段/库列里的面别值 → 类型收窄(flush 与查询侧共用) */
export function isGeoSurface(v: string): v is GeoSurface {
  return v === "llms_index" || v === "llms_full" || v === "post_md";
}

/**
 * GEO 路径 → 文章 id 文本(仅 post_md 面有文章粒度;id 锚定口径,装饰 slug 不参与;
 * 非 id 形态段(旧单段 .md 301 形态不走此面)返回 null → 记账空串。
 */
export function geoPostIdOf(surface: GeoSurface, barePath: string): string | null {
  if (surface !== "post_md") return null;
  const seg = barePath
    .replace(/^\/+|\/+$/g, "")
    .slice("post/".length)
    .replace(/\.md$/, "");
  return parsePostSegment(seg)?.id.toString() ?? null;
}
