/**
 * 洞察源注册单表(M56 review P2-24):此前源属性拆两处维护——ingest.ts
 * (medium/enabled)与 constants.ts(kind/label),新增源要改两三个文件;
 * 收口为本表逐源一行 {medium, enabled, kind, label}。medium/enabled/kind/label
 * 均从本表投影导出,ingest.ts/constants.ts 仅转出口(调用方 import 路径零改动)。
 *
 * 新增 source type 收口动作:本表登记一行 → 外部热榜渠道另在 hotlist/registry.ts
 * 挂 fetcher(站内/电报源不需要);电报 AI 产物经 telegram 链入池(telegram/ingest.ts)。
 */
export const SOURCE_REGISTRY = {
  /** 站内搜索问句(批③ 渠道转向 2026-10-18 停接入,存量行保留) */
  "internal-search": {
    medium: "search",
    enabled: false,
    kind: "pain",
    label: "站内搜索",
    lang: "zh",
    region: "cn",
  },
  /** 助手问句(同上,停接入) */
  "internal-agent": {
    medium: "search",
    enabled: false,
    kind: "pain",
    label: "助手问句",
    lang: "zh",
    region: "cn",
  },
  "internal-comment": {
    medium: "voice",
    enabled: true,
    kind: "pain",
    label: "文章评论",
    lang: "zh",
    region: "cn",
  },
  /** 站点反馈(同上,停接入) */
  "internal-feedback": {
    medium: "voice",
    enabled: false,
    kind: "pain",
    label: "站点反馈",
    lang: "zh",
    region: "cn",
  },
  "telegram-ai": {
    medium: "ai-record",
    enabled: true,
    kind: "hot",
    label: "电报AI解读",
    lang: "zh",
    region: "cn",
  },
  /** 热榜三源(批③):百度/B站热搜词=搜索形态,知乎热榜=社区讨论声音(方案 §2) */
  "hot-baidu": {
    medium: "search",
    enabled: true,
    kind: "hot",
    label: "百度热搜",
    lang: "zh",
    region: "cn",
  },
  "hot-zhihu": {
    medium: "voice",
    enabled: true,
    kind: "hot",
    label: "知乎热榜",
    lang: "zh",
    region: "cn",
  },
  "hot-bilibili": {
    medium: "search",
    enabled: true,
    kind: "hot",
    label: "B站热搜",
    lang: "zh",
    region: "cn",
  },
} as const;

export type InsightSource = keyof typeof SOURCE_REGISTRY;

export type InsightMedium = (typeof SOURCE_REGISTRY)[InsightSource]["medium"];

export type InsightSourceKind = (typeof SOURCE_REGISTRY)[InsightSource]["kind"];

/** 语言/地域取值(M58 批①):lang 为 BCP-47 主语言子标签,region 为 cn|global 两档。
 * 显式联合而非从注册表推断——新增海外源不必先改类型。 */
export type InsightLang = "zh" | "en" | "ja" | "ko" | "fr" | "de" | "es" | "ru";

export type InsightRegion = "cn" | "global";

/** 需要翻译的语言(非中文)判定;zh 系一律不翻 */
export function needsTranslation(lang: string | null | undefined): boolean {
  return !!lang && !lang.toLowerCase().startsWith("zh");
}

/** 源 → 五介质映射(方案 §2;ingest.ts 写侧消费) */
export const INSIGHT_SOURCE_MEDIUM: Record<InsightSource, InsightMedium> = Object.fromEntries(
  Object.entries(SOURCE_REGISTRY).map(([key, def]) => [key, def.medium]),
) as Record<InsightSource, InsightMedium>;

/**
 * 在役源白名单(停接入闸,ingest.ts 文件头注):站内三源(搜索/agent/反馈)批③
 * 退出,评论与电报 AI 保留;热榜三源为批③ 新渠道。恢复=enabled 翻回 true,
 * 调用点无需动。
 */
export const INSIGHT_SOURCES_ENABLED: ReadonlySet<InsightSource> = new Set(
  Object.entries(SOURCE_REGISTRY)
    .filter(([, def]) => def.enabled)
    .map(([key]) => key as InsightSource),
);

/** 信号源 → 簇别初始引导值(批③ 验收三轮·痛点扩围:kind 不再按源定生死)。
 * 聚类已单池归簇(近邻跨 kind),此处映射仅作新建簇的引导值,LLM 打标日批
 * 按簇内容语义覆判 hot|pain(label.ts 契约;constants.ts 转出口,cluster.ts 消费) */
export const INSIGHT_SOURCE_KIND: Record<InsightSource, InsightSourceKind> = Object.fromEntries(
  Object.entries(SOURCE_REGISTRY).map(([key, def]) => [key, def.kind]),
) as Record<InsightSource, InsightSourceKind>;

/** 洞察源展示名单源(页签/合并榜 chip/热榜台账/蜘蛛源台账共用;曾 shared.tsx
 * 与 hot-source.ts 两份手抄) */
export const SOURCE_LABELS: Record<InsightSource, string> = Object.fromEntries(
  Object.entries(SOURCE_REGISTRY).map(([key, def]) => [key, def.label]),
) as Record<InsightSource, string>;

/** 源级默认语言/地域(M58;混合源在 ingest 入参逐条覆盖) */
export const INSIGHT_SOURCE_LANG: Record<InsightSource, InsightLang> = Object.fromEntries(
  Object.entries(SOURCE_REGISTRY).map(([key, def]) => [key, def.lang]),
) as Record<InsightSource, InsightLang>;

export const INSIGHT_SOURCE_REGION: Record<InsightSource, InsightRegion> = Object.fromEntries(
  Object.entries(SOURCE_REGISTRY).map(([key, def]) => [key, def.region]),
) as Record<InsightSource, InsightRegion>;
