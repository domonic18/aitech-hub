/**
 * 洞察视图共享小件(M34 批②,纯展示零状态):源/介质中文标签映射、介质徽章、
 * 覆盖度徽章(空白标红=选题机会,方案 §6 痛点卡)、异动徽章、时间格式化。
 * 批① 页内映射随批② 组件化收敛至此,页面与详情页共用。
 */
import Link from "next/link";

import { MEDIUM_LABELS, SOURCE_LABELS, type InsightMediumVocab } from "@/lib/insight/constants";
import type { InsightSource } from "@/lib/insight/ingest";

// 展示名与介质标签下沉 domain constants 单源(hot-source 台账同用),此处转出口
export { MEDIUM_LABELS, SOURCE_LABELS };

/** 洞察窗口 chips 白名单(总览与簇详情两页共用解析,此前两页各自手写) */
export const WINDOWS = [7, 30, 90] as const;

/** 源→图表色(趋势堆叠柱/占比条共用;令牌色 dark/light 双主题自适应) */
export const SOURCE_COLORS: Record<InsightSource, string> = {
  "internal-search": "bg-text-3",
  "internal-agent": "bg-text-2",
  "internal-feedback": "bg-text-3",
  "internal-comment": "bg-amber",
  "telegram-ai": "bg-accent",
  "hot-baidu": "bg-blue",
  "hot-zhihu": "bg-green",
  "hot-bilibili": "bg-red",
};

export const COVERAGE_LABELS: Record<string, string> = {
  covered: "覆盖充分",
  partial: "部分覆盖",
  blank: "内容空白",
};

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 热榜源短渠道名(百度/知乎/B站;F11 v2 渠道页签与合并榜来源 chip 共用,
 * 未来新源按「XX热搜/热榜」命名自动派生,免逐个登记) */
export function shortSource(source: string): string {
  return (SOURCE_LABELS[source as keyof typeof SOURCE_LABELS] ?? source).replace(
    /(热搜|热榜)$/,
    "",
  );
}

/** 洞察页查询参数全集(跨分区互保:w=总览/云图窗口,day=热榜回看日,
 * hs=热榜源展示切换,source/from/to=信号明细过滤) */
export type InsightViewParams = {
  source?: string;
  w?: string;
  from?: string;
  to?: string;
  day?: string;
  hs?: string;
};

/** 洞察页链接构造:未定义值不落串,其余参数原样保留 */
export function insightHref(
  params: InsightViewParams,
  overrides: Partial<InsightViewParams> = {},
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...overrides })) {
    if (v) sp.set(k, v);
  }
  const qs = sp.toString();
  return `/admin/insight/${qs ? `?${qs}` : ""}`;
}

/** 北京日字符串(YYYY-MM-DD)±n 天 */
export function shiftDay(day: string, delta: number): string {
  const ms = new Date(`${day}T00:00:00+08:00`).getTime() + delta * 86_400_000;
  return new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

/** 北京当日 YYYY-MM-DD(sv-SE locale 恰好输出 ISO 形) */
export function todayCn(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

const badge = "rounded-sm px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap";

/** 介质徽章(方案 §2:介质数是可解释的强信号维度;钱✓搜索✓=多介质留痕) */
export function MediaBadges({ media }: { media: string[] }): React.ReactElement {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {media.map((m) => (
        <span key={m} className={`${badge} bg-panel-2 text-text-2`} title={`留痕介质:${m}`}>
          {MEDIUM_LABELS[m as InsightMediumVocab] ?? m}
        </span>
      ))}
      {media.length >= 2 && (
        <span className={`${badge} bg-accent-dim text-accent`}>{media.length}介质</span>
      )}
    </span>
  );
}

/** 覆盖度徽章:blank 标红(=选题机会),partial 琥珀,covered 绿 */
export function CoverageBadge({
  score,
  state,
}: {
  score: number | null;
  state: string | null;
}): React.ReactElement | null {
  if (state === null || score === null) return null;
  const tone =
    state === "blank"
      ? "bg-red/12 text-red"
      : state === "partial"
        ? "bg-amber/12 text-amber-hi"
        : "bg-green/12 text-green";
  return (
    <span className={`${badge} ${tone}`} title="内容覆盖度:站点既有文章对该簇的覆盖程度">
      {COVERAGE_LABELS[state] ?? state} {Math.round(score * 100)}%
    </span>
  );
}

/** 异动徽章(读侧双门判定已算好,这里只展示) */
export function AnomalyBadge(): React.ReactElement {
  return (
    <span className={`${badge} bg-red/12 text-red`} title="热度异动:近值远超前 3 日均值">
      异动
    </span>
  );
}

/** 可写角度一行文案(F25/F26 actionCard):覆盖度状态派生,LLM 选题生成未立项
 * 前先给确定性文案;无覆盖度评分(未日批)显观察提示。 */
export function writeAngleLine(state: string | null): string {
  if (state === "blank") return "站内尚无覆盖该簇的稿件——内容空白即首发窗口,适合系统性切入。";
  if (state === "partial") return "既有稿件零散提及,缺系统性对比/实操——按「能跑通」路线整合成篇。";
  if (state === "covered") return "覆盖较全——从最新动态、差异实测或反例角度补更。";
  return "覆盖度待日批评估(03:57 跑完回写);可先从代表信号判断切入角度。";
}

/** 簇名(未打标显示占位;详情链接) */
export function ClusterLabelLink({
  id,
  label,
}: {
  id: string;
  label: string | null;
}): React.ReactElement {
  return (
    <Link
      href={`/admin/insight/clusters/${id}`}
      className="text-text-1 hover:text-accent"
      title={label ?? "未打标簇,详情见信号原话"}
    >
      {label ?? "待打标簇"}
    </Link>
  );
}
