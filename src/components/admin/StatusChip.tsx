/**
 * 状态小徽(技术债批②,收口 UsersTable/CommentsTable/KeywordTable 三处内联):
 * 圆点 + 文字;色 tone 由调用方传域内映射(组件不感知具体状态域)。
 */
export default function StatusChip({
  tone,
  label,
}: {
  tone: string;
  label: string;
}): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}
