"use client";

/**
 * 设置页共享基元(2026-10-09 验收反馈问题1:站点设置/邮件配置界面按主流
 * 设置形态重构):分区卡(图标+标题+状态位)、网格字段(标签在上、说明在下)、
 * 底部操作条、状态徽标。纯展示容器,不发请求不含业务态;表单状态仍归各页
 * 客户端组件。设计令牌沿用 admin 既有体系(border-line/bg-panel/accent)。
 */
export const INPUT =
  "w-full rounded-sm border border-line bg-panel-2 px-2.5 py-2 text-xs text-text-1 outline-none transition-colors focus:border-accent disabled:opacity-60";

/** 分区卡:头部 = 图标章 + 标题/描述 + 右侧状态位;body 由调用方组网格 */
export function SettingsSection({
  icon,
  title,
  description,
  status,
  children,
}: {
  icon: string;
  title: string;
  description?: string;
  status?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="rounded-md border border-line bg-panel">
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-accent/10 text-accent">
          <svg className="ic ic-sm" aria-hidden="true">
            <use href={`#${icon}`} />
          </svg>
        </span>
        <div className="min-w-0">
          <b className="text-[13px] text-text-1">{title}</b>
          {description ? (
            <p className="mt-0.5 text-[11px] leading-relaxed text-text-3">{description}</p>
          ) : null}
        </div>
        {status ? <div className="ml-auto shrink-0 pl-3">{status}</div> : null}
      </header>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

/** 字段:标签在上(必填标识可选)、控件居中、说明在下;作为网格单元使用 */
export function SettingsField({
  label,
  htmlFor,
  required,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[11px] font-medium text-text-2">
        {label}
        {required ? <span className="ml-0.5 text-red">*</span> : null}
      </label>
      {children}
      {hint ? <p className="text-[11px] leading-relaxed text-text-3">{hint}</p> : null}
    </div>
  );
}

/** 字段网格:窄屏单列,sm 起两列(cols=3 时三列,用于短数字字段) */
export function SettingsGrid({
  cols = 2,
  children,
}: {
  cols?: 2 | 3;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className={`grid grid-cols-1 gap-x-4 gap-y-4 ${cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
    >
      {children}
    </div>
  );
}

/** 底部操作条:左消息区、右动作区;sticky 可选(长表单保存键随手可及) */
export function SettingsActions({
  message,
  children,
  sticky = false,
}: {
  message?: React.ReactNode;
  children: React.ReactNode;
  sticky?: boolean;
}): React.ReactElement {
  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-md border border-line bg-panel px-4 py-3 ${
        sticky ? "sticky bottom-3 z-10 shadow-sm" : ""
      }`}
    >
      <div className="min-w-0 flex-1">{message}</div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

const CHIP_TONES = {
  ok: "border-accent/30 bg-accent/10 text-accent",
  warn: "border-amber/30 bg-amber/10 text-amber",
  muted: "border-line bg-panel-2 text-text-3",
} as const;

/** 状态徽标:ok=已启用/accent,warn=注意/amber,muted=未配置/中性 */
export function StatusChip({
  tone,
  children,
}: {
  tone: keyof typeof CHIP_TONES;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${CHIP_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export const BTN_PRIMARY =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-sm bg-accent px-3 py-2 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";

export const BTN_SECONDARY =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-line bg-panel px-3 py-2 text-[11px] text-text-2 transition-colors hover:border-line-hover hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-60";
