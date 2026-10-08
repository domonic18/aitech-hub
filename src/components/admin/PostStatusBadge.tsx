import type { PostDisplayState } from "@/lib/content/post-schema";

/**
 * 状态徽标(原型 admin-posts .status-badge):圆点 + soft chip(tint 底、无描边、
 * 4px 圆角),展示态三色——已发布(绿 .st-pub)/ 草稿(琥珀 .st-draft)/ 已下架
 * (灰 .st-off)。2026-10-06 验收反馈:带描边药丸视觉过重,改轻量 soft chip。
 */
const STYLES: Record<PostDisplayState, { chip: string; dot: string; label: string }> = {
  published: { chip: "bg-green/12 text-green", dot: "bg-green", label: "已发布" },
  unpublished: { chip: "bg-panel-2 text-text-3", dot: "bg-text-3", label: "已下架" },
  draft: { chip: "bg-amber/12 text-amber", dot: "bg-amber", label: "草稿" },
};

export default function PostStatusBadge({
  state,
}: {
  state: PostDisplayState;
}): React.ReactElement {
  const s = STYLES[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium ${s.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  );
}
