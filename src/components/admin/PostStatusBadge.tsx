import type { PostDisplayState } from "@/lib/content/post-schema";

/**
 * 状态徽标(原型 admin-posts .status-badge):圆点 + 文案,展示态三色——
 * 已发布(绿)/ 已下架(琥珀)/ 草稿(灰)。
 */
const STYLES: Record<PostDisplayState, { dot: string; text: string; label: string }> = {
  published: { dot: "bg-green", text: "text-green", label: "已发布" },
  unpublished: { dot: "bg-amber", text: "text-amber", label: "已下架" },
  draft: { dot: "bg-text-3", text: "text-text-3", label: "草稿" },
};

export default function PostStatusBadge({
  state,
}: {
  state: PostDisplayState;
}): React.ReactElement {
  const s = STYLES[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs ${s.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  );
}
