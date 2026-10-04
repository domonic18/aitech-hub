/** 电报流治理表内徽章(批⑧从 page 抽出收敛行数):状态 + 媒体形态,纯展示。 */

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    visible: { cls: "bg-green/10 text-green", label: "可见" },
    hidden: { cls: "bg-amber/10 text-amber", label: "隐藏" },
    archived: { cls: "bg-panel-2 text-text-3", label: "归档" },
  };
  const s = map[status] ?? { cls: "bg-panel-2 text-text-3", label: status };
  return <span className={`rounded-sm px-1.5 py-px text-[10px] ${s.cls}`}>{s.label}</span>;
}

/** 媒体徽章(原型 media-tag:文字 i-filetext / 短视频 i-video) */
export function MediaBadge({ mediaType }: { mediaType: string }) {
  const video = mediaType === "video";
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

/** 解读态徽章(M9;title 带 lastAiError 供失败排查;null=未解读) */
export function AiBadge({
  aiStatus,
  lastAiError,
}: {
  aiStatus: string | null;
  lastAiError: string | null;
}) {
  const map: Record<string, { cls: string; label: string }> = {
    pending: { cls: "bg-panel-2 text-text-2", label: "排队中" },
    processing: { cls: "bg-accent-dim text-accent", label: "解读中" },
    done: { cls: "bg-green/10 text-green", label: "已解读" },
    missing_transcript: { cls: "bg-amber/10 text-amber", label: "无转写 · 文案概括" },
    failed: { cls: "bg-red/10 text-red", label: "失败" },
  };
  const s = (aiStatus !== null && aiStatus in map ? map[aiStatus] : undefined) ?? {
    cls: "bg-panel-2 text-text-3",
    label: "未解读",
  };
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-sm px-1.5 py-px text-[10px] ${s.cls}`}
      title={lastAiError ?? undefined}
    >
      {s.label}
    </span>
  );
}
