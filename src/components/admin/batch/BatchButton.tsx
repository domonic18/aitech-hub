"use client";

/**
 * 批量条动作钮(技术债批②):三 variant 收口五表重复的按钮样式——
 * primary(accent 实心)/ outline(accent 描边)/ danger(red 描边)。
 * busyLabel 缺省时 busy 期间沿用 label(如「批量停用」无进行中文案)。
 */
const VARIANTS = {
  primary: "bg-accent text-white hover:bg-accent-hover",
  outline: "border border-accent/50 bg-transparent text-accent hover:bg-accent-dim",
  danger: "border border-red/50 bg-transparent text-red hover:bg-red/10",
} as const;

export default function BatchButton({
  variant,
  label,
  busy = false,
  busyLabel,
  disabled = false,
  onClick,
  title,
}: {
  variant: keyof typeof VARIANTS;
  label: string;
  busy?: boolean;
  /** busy 期间替换文案;缺省沿用 label */
  busyLabel?: string;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`cursor-pointer rounded-sm px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]}`}
    >
      {busy && busyLabel !== undefined ? busyLabel : label}
    </button>
  );
}
