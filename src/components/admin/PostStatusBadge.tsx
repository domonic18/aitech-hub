import type { PostDisplayState } from "@/lib/content/post-schema";

/**
 * 状态徽标(原型 admin-posts .status-badge):圆点 + 药丸底色/描边,展示态三色——
 * 已发布(绿 .st-pub)/ 草稿(琥珀 .st-draft)/ 已下架(灰 .st-off)。
 */
const STYLES: Record<PostDisplayState, { pill: string; dot: string; label: string }> = {
  published: { pill: "border-green/35 bg-green/10 text-green", dot: "bg-green", label: "已发布" },
  unpublished: { pill: "border-line bg-panel-2 text-text-3", dot: "bg-text-3", label: "已下架" },
  draft: { pill: "border-amber/35 bg-amber/10 text-amber", dot: "bg-amber", label: "草稿" },
};

export default function PostStatusBadge({
  state,
}: {
  state: PostDisplayState;
}): React.ReactElement {
  const s = STYLES[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${s.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  );
}
