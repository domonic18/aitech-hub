"use client";

/**
 * 多选勾选格(技术债批②,五表共用,样式/aria 单点收口):
 * - SelectAllTh:表头全选格(整 th);
 * - RowCheckbox:行内勾选 input(td 由各表自行包——列宽/对齐微差留表侧)。
 */
export function SelectAllTh({
  allSelected,
  disabled = false,
  onToggle,
}: {
  allSelected: boolean;
  disabled?: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <th className="w-10 px-3 py-2.5">
      <input
        type="checkbox"
        aria-label="全选本页"
        className="accent-[var(--accent)]"
        checked={allSelected}
        onChange={onToggle}
        disabled={disabled}
      />
    </th>
  );
}

export function RowCheckbox({
  label,
  checked,
  disabled = false,
  onToggle,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="accent-[var(--accent)]"
      checked={checked}
      onChange={onToggle}
      disabled={disabled}
    />
  );
}
