"use client";

/**
 * 搜索页控制台输入框(K1,原型 site-search .grep-box):accent 2px 边框 +
 * 外发光、❯ 符号、「问一下 ⏎」提交钮、建议词 chips。GET /search 整页导航
 * (命中列表 SSR 直出);镜面光标逻辑平移 HeroConsole(DESIGN-SPEC §5:
 * 失焦随文字移动并闪烁,聚焦隐藏交还原生 caret)。
 */
import Link from "next/link";
import { useRef } from "react";

/** 建议词(原型 hint-line 口径:自然语言问句 + 关键词混合) */
const SUGGESTIONS = [
  "本周 Agent 框架有什么新进展?",
  "MCP 入门到实战",
  "能本地跑 LLM 的开源项目",
  "Prisma",
] as const;

export default function SearchConsole({ q }: { q: string }): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);

  /** 镜面光标同步:量出光标前文本宽度定位(输入/方向键移动时) */
  const syncCaret = (): void => {
    const input = inputRef.current;
    const caret = caretRef.current;
    const measure = measureRef.current;
    if (!input || !caret || !measure) return;
    measure.textContent = input.value.slice(0, input.selectionStart ?? input.value.length);
    caret.style.left = `${measure.offsetWidth}px`;
  };

  const hideCaret = (): void => {
    if (caretRef.current) caretRef.current.style.display = "none";
  };

  const showCaret = (): void => {
    if (caretRef.current) caretRef.current.style.display = "block";
    syncCaret();
  };

  return (
    <div>
      <form action="/search" method="get" role="search">
        <div className="flex items-center gap-3.5 rounded-md border-2 border-accent bg-panel py-1 pl-5 pr-1.5 shadow-[0_0_0_4px_var(--accent-dim)]">
          <span className="flex-none font-mono text-[15px] text-green">❯</span>
          <span className="relative flex min-w-0 flex-1 items-center">
            <span
              ref={measureRef}
              aria-hidden="true"
              className="invisible absolute left-0 whitespace-pre font-mono text-[16px]"
            />
            <span
              ref={caretRef}
              aria-hidden="true"
              className="q-caret pointer-events-none absolute left-0 h-[19px] w-[10px] bg-accent shadow-[0_0_8px_var(--glow)]"
            />
            <input
              ref={inputRef}
              type="text"
              name="q"
              defaultValue={q}
              placeholder="问点什么,或搜索资讯 / 教程 / 项目…"
              autoComplete="off"
              aria-label="Agent 搜索"
              onInput={syncCaret}
              onKeyUp={syncCaret}
              onFocus={hideCaret}
              onBlur={showCaret}
              className="relative z-[1] h-[46px] w-full min-w-0 border-none bg-transparent font-mono text-[16px] text-text-1 outline-none caret-accent placeholder:text-text-3"
            />
          </span>
          <button
            type="submit"
            className="flex-none cursor-pointer rounded-sm bg-accent px-[22px] py-[11px] font-mono text-sm text-white hover:bg-accent-hover"
          >
            问一下 ⏎
          </button>
        </div>
      </form>
      <div className="mt-3.5 text-[13px] text-text-3">
        试试:
        {SUGGESTIONS.map((s) => (
          <Link
            key={s}
            href={`/search?q=${encodeURIComponent(s)}`}
            className="mx-1.5 font-mono text-text-2 hover:text-accent-hover"
          >
            {s}
          </Link>
        ))}
      </div>
    </div>
  );
}
