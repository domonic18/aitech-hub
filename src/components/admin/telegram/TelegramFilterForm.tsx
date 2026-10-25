"use client";

/**
 * 电报治理筛选表单(M31 验收反馈:下拉改选即提交——此前嵌在无 JS GET form,
 * 选完必须搜索框回车才生效,与分段胶囊的即时导航不一致)。select onChange →
 * requestSubmit() 原生 GET 跳转,URL 仍为唯一状态源;搜索框保持回车提交。
 * 选项由服务端筛选栏下发(telegram-admin 含 prisma,客户端不可 import)。
 */

const SELECT_CLS =
  "rounded-sm border border-line bg-panel px-2 py-1.5 text-xs text-text-2 outline-none focus:border-accent";

export default function TelegramFilterForm({
  segment,
  blogger,
  mediaValue,
  aiValue,
  sourceValue,
  q,
  mediaOptions,
  aiOptions,
  sourceOptions,
}: {
  segment: string;
  blogger?: string;
  mediaValue: string;
  aiValue: string;
  sourceValue: string;
  q?: string;
  mediaOptions: Array<{ value: string; label: string }>;
  aiOptions: Array<{ value: string; label: string }>;
  sourceOptions: Array<{ value: string; label: string }>;
}): React.ReactElement {
  /** 下拉改选即查(原生表单 GET 跳转,整页 RSC 刷新) */
  function submitNow(e: React.ChangeEvent<HTMLSelectElement>): void {
    e.currentTarget.form?.requestSubmit();
  }
  return (
    <form
      method="GET"
      action="/admin/telegram/"
      className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto"
    >
      {segment !== "all" && <input type="hidden" name="status" value={segment} />}
      {blogger && <input type="hidden" name="blogger" value={blogger} />}
      <select
        name="media"
        defaultValue={mediaValue}
        aria-label="媒体类型筛选"
        onChange={submitNow}
        className={SELECT_CLS}
      >
        {mediaOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        name="ai"
        defaultValue={aiValue}
        aria-label="解读态筛选"
        onChange={submitNow}
        className={SELECT_CLS}
      >
        {aiOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        name="source"
        defaultValue={sourceValue}
        aria-label="来源渠道筛选"
        onChange={submitNow}
        className={SELECT_CLS}
      >
        {sourceOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-2 rounded-sm border border-line bg-panel px-2.5 py-1.5 focus-within:border-accent">
        <svg className="ic ic-sm text-text-3" aria-hidden="true">
          <use href="#i-search" />
        </svg>
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="搜索标题 / 摘要…"
          className="w-full bg-transparent text-[13px] outline-none placeholder:text-text-3 sm:w-52"
        />
      </div>
    </form>
  );
}
