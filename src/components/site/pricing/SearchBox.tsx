"use client";

/**
 * 模型快捷搜索框(UX P1):250ms 防抖回写 URL(q 参数),
 * 命中 modelKey / modelDisplayName / modelFamily / vendor。
 * 纯客户端控件,SSR 不渲染(挂载后才出现,不影响 SEO 全量行)。
 */
import { useEffect, useRef, useState } from "react";

export function SearchBox({
  value,
  onChange,
  placeholder = "搜索模型 / 厂商…",
}: {
  value: string;
  onChange: (q: string) => void;
  placeholder?: string;
}): React.ReactElement {
  const [draft, setDraft] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // URL popstate 回填(后退/前进时同步)
  useEffect(() => {
    setDraft(value);
  }, [value]);

  // 防抖回写
  useEffect(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    if (draft === value) return;
    timerRef.current = setTimeout(() => onChange(draft.trim()), 250);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [draft, value, onChange]);

  return (
    <div className="relative">
      <input
        type="search"
        value={draft}
        placeholder={placeholder}
        maxLength={64}
        aria-label="搜索模型或厂商"
        onChange={(e) => setDraft(e.target.value)}
        className="w-full rounded-sm border border-line bg-panel-2 py-1.5 pl-8 pr-7 text-xs text-text-1 outline-none placeholder:text-text-3 focus:border-accent [&::-webkit-search-cancel-button]:hidden"
      />
      <svg
        className="ic pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-3"
        aria-hidden="true"
      >
        <use href="#i-search" />
      </svg>
      {draft !== "" && (
        <button
          type="button"
          aria-label="清空搜索"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer text-text-3 hover:text-text-1"
          onClick={() => {
            setDraft("");
            onChange("");
          }}
        >
          <svg className="ic h-3.5 w-3.5" aria-hidden="true">
            <use href="#i-close" />
          </svg>
        </button>
      )}
    </div>
  );
}
