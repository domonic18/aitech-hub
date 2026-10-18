/**
 * 洞察视图共享小件(M34 批②,纯展示零状态):源/介质中文标签映射、介质徽章、
 * 覆盖度徽章(空白标红=选题机会,方案 §6 痛点卡)、异动徽章、时间格式化。
 * 批① 页内映射随批② 组件化收敛至此,页面与详情页共用。
 */
import Link from "next/link";

import type { InsightSource } from "@/lib/insight/ingest";

export const SOURCE_LABELS: Record<InsightSource, string> = {
  "internal-search": "站内搜索",
  "internal-agent": "助手问句",
  "internal-comment": "文章评论",
  "internal-feedback": "站点反馈",
  "telegram-ai": "电报AI解读",
  "hot-baidu": "百度热搜",
  "hot-zhihu": "知乎热榜",
  "hot-bilibili": "B站热搜",
};

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

export const MEDIUM_LABELS: Record<string, string> = {
  money: "钱",
  time: "时间",
  voice: "声音",
  search: "搜索",
  "ai-record": "AI记录",
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

const badge = "rounded-sm px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap";

/** 介质徽章(方案 §2:介质数是可解释的强信号维度;钱✓搜索✓=多介质留痕) */
export function MediaBadges({ media }: { media: string[] }): React.ReactElement {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {media.map((m) => (
        <span key={m} className={`${badge} bg-panel-2 text-text-2`} title={`留痕介质:${m}`}>
          {MEDIUM_LABELS[m] ?? m}
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
