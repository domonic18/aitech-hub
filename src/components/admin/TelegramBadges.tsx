/** 电报流治理表内徽章(批⑧从 page 抽出收敛行数):状态 + 媒体形态,纯展示。 */
import {
  AI_STATUS_LABELS,
  TELEGRAM_AI_DONE,
  TELEGRAM_AI_FAILED,
  TELEGRAM_AI_MISSING_TRANSCRIPT,
  TELEGRAM_AI_PENDING,
  TELEGRAM_AI_PROCESSING,
  TELEGRAM_MEDIA_VIDEO,
} from "@/lib/telegram/constants";

/** 状态徽章(原型 .status-badge soft chip:tint 底+圆点、无描边;可见绿/隐藏琥珀/归档灰) */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; dot: string; label: string }> = {
    visible: {
      cls: "bg-green/12 text-green",
      dot: "bg-green",
      label: "可见",
    },
    hidden: {
      cls: "bg-amber/12 text-amber",
      dot: "bg-amber",
      label: "隐藏",
    },
    archived: { cls: "bg-panel-2 text-text-3", dot: "bg-text-3", label: "归档" },
  };
  const s = map[status] ?? {
    cls: "bg-panel-2 text-text-3",
    dot: "bg-text-3",
    label: status,
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-2 py-px text-[11px] font-medium ${s.cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  );
}

/** 媒体徽章(原型 media-tag:文字 i-filetext / 短视频 i-video) */
export function MediaBadge({ mediaType }: { mediaType: string }) {
  const video = mediaType === TELEGRAM_MEDIA_VIDEO;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-px text-[10px] ${
        video ? "bg-accent-dim text-accent" : "bg-panel-2 text-text-2"
      }`}
    >
      <svg className="ic ic-sm" aria-hidden="true">
        <use href={video ? "#i-video" : "#i-filetext"} />
      </svg>
      {video ? "短视频" : "文字"}
    </span>
  );
}

/** 解读态徽章(M9;title 带 lastAiError 供失败排查;null=未解读)。
 * 文案单点在 telegram/constants#AI_STATUS_LABELS(统计/徽章共用);cls 是 UI 关注点留本地。 */
const AI_BADGE_CLS: Record<string, string> = {
  [TELEGRAM_AI_PENDING]: "bg-panel-2 text-text-2",
  [TELEGRAM_AI_PROCESSING]: "bg-accent-dim text-accent",
  [TELEGRAM_AI_DONE]: "bg-green/10 text-green",
  [TELEGRAM_AI_MISSING_TRANSCRIPT]: "bg-amber/10 text-amber",
  [TELEGRAM_AI_FAILED]: "bg-red/10 text-red",
};

export function AiBadge({
  aiStatus,
  lastAiError,
}: {
  aiStatus: string | null;
  lastAiError: string | null;
}) {
  const known = aiStatus !== null && aiStatus in AI_BADGE_CLS;
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-sm px-1.5 py-px text-[10px] ${
        known ? AI_BADGE_CLS[aiStatus!] : "bg-panel-2 text-text-3"
      }`}
      title={lastAiError ?? undefined}
    >
      {(known && AI_STATUS_LABELS[aiStatus!]) || "未解读"}
    </span>
  );
}
