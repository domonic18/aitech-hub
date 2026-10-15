/**
 * 电报流治理筛选栏(批C 从 page 抽出):分段胶囊(带计数)+ 博主活动 chip +
 * 媒体/解读态/来源下拉 + 搜索框。下拉即选即查(M31 验收反馈,交互收口
 * TelegramFilterForm 客户端组件);分段/博主 chip 为 Link 即时导航。
 * 链接由调用方 hrefFor 生成;标签表是本页 UI 词汇,不进 domain constants。
 */
import Link from "next/link";

import TelegramFilterForm from "@/components/admin/TelegramFilterForm";
import {
  TELEGRAM_AI_FILTERS,
  TELEGRAM_LIST_SEGMENTS,
  type TelegramAiFilter,
  type TelegramListSegment,
} from "@/lib/telegram/telegram-admin";
import type { FeedMediaFilter } from "@/lib/telegram/feed-view";

const SEG_LABELS: Record<TelegramListSegment, string> = {
  all: "全部",
  visible: "可见",
  hidden: "隐藏",
  archived: "归档",
};

const MEDIA_LABELS: Record<FeedMediaFilter, string> = {
  all: "全部媒体",
  text: "文字",
  video: "短视频",
};

/** 解读态下拉(M10 批⑤):值同 TELEGRAM_AI_FILTERS,空=全部 */
const AI_FILTER_LABELS: Record<TelegramAiFilter, string> = {
  none: "未解读",
  working: "解读中",
  done: "已解读",
  failed: "解读失败",
};

export default function TelegramFilterBar({
  segment,
  counts,
  q,
  media,
  aiFilter,
  blogger,
  sourceRaw,
  sources,
  hrefFor,
}: {
  segment: TelegramListSegment;
  counts: Record<TelegramListSegment, number>;
  q?: string;
  media: FeedMediaFilter;
  aiFilter?: TelegramAiFilter;
  blogger?: string;
  /** 来源下拉的当前值(原样回显,非法值由取数层忽略) */
  sourceRaw?: string;
  sources: Array<{ id: number; name: string }>;
  /** 分段/页码 → 链接(保持既有筛选;omit 指定要去掉的键) */
  hrefFor: (seg: TelegramListSegment, p: number, omit?: "blogger") => string;
}) {
  const mediaOptions = [
    { value: "", label: MEDIA_LABELS.all },
    { value: "text", label: MEDIA_LABELS.text },
    { value: "video", label: MEDIA_LABELS.video },
  ];
  const aiOptions = [
    { value: "", label: "全部解读态" },
    ...TELEGRAM_AI_FILTERS.map((f) => ({ value: f, label: AI_FILTER_LABELS[f] })),
  ];
  const sourceOptions = [
    { value: "", label: "全部来源" },
    ...sources.map((s) => ({ value: String(s.id), label: s.name })),
  ];
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex overflow-hidden rounded-sm border border-line">
        {TELEGRAM_LIST_SEGMENTS.map((seg) => (
          <Link
            key={seg}
            href={hrefFor(seg, 1)}
            className={`border-r border-line px-4 py-2 text-[13px] last:border-r-0 ${
              seg === segment
                ? "bg-accent-dim font-semibold text-accent"
                : "bg-panel text-text-2 hover:bg-panel-2"
            }`}
          >
            {SEG_LABELS[seg]} {counts[seg]}
          </Link>
        ))}
      </div>
      {blogger && (
        <Link
          href={hrefFor(segment, 1, "blogger")}
          className="inline-flex items-center gap-1 rounded-sm border border-accent/40 bg-accent-dim px-2 py-1 text-xs text-accent hover:border-accent"
          title="清除博主筛选"
        >
          博主:{blogger} ✕
        </Link>
      )}
      <TelegramFilterForm
        segment={segment}
        blogger={blogger}
        mediaValue={media === "all" ? "" : media}
        aiValue={aiFilter ?? ""}
        sourceValue={sourceRaw ?? ""}
        q={q}
        mediaOptions={mediaOptions}
        aiOptions={aiOptions}
        sourceOptions={sourceOptions}
      />
    </div>
  );
}
