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
