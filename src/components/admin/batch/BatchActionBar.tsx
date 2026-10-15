"use client";

/**
 * 批量动作条(M31 验收反馈:六后台面批量治理共用,PostsTable 批量条同款
 * 视觉收口为通用件):选中计数 + 动作钮(children 注入)+ 取消选择 +
 * 进行中/结果/错误文案插槽。选中为空且无文案时不渲染。
 */
export default function BatchActionBar({
  unit,
  count,
  busy = false,
  msg = null,
  error = null,
  onCancel,
  children,
}: {
  /** 计数单位(篇/条/项/名…),用于「已选 N unit」 */
  unit: string;
  count: number;
  busy?: boolean;
  msg?: string | null;
  error?: string | null;
  onCancel?: () => void;
  children?: React.ReactNode;
}): React.ReactElement | null {
  if (count === 0 && msg === null && error === null) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line bg-accent-dim/40 px-4 py-2.5 text-xs">
      <span className="text-text-2">
        已选 <b className="text-text-1">{count}</b> {unit}
      </span>
      {children}
      {!busy && count > 0 && onCancel && (
        <button
          type="button"
          className="cursor-pointer text-text-3 hover:text-text-1"
          onClick={onCancel}
        >
          取消选择
        </button>
      )}
      {msg && <span className="text-accent">{msg}</span>}
      {error && <span className="text-red">{error}</span>}
    </div>
  );
}
