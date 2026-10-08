"use client";

/**
 * 首页 Hub 控制台 hero(M5-e,原型 site-home §Hero):终端窗(whoami + 站点状态行,
 * 数据为真实已发布文章数)+ 搜索输入框(GET /search;K1 起三域检索,Agent 化
 * 两层交互见 arch/04 §3)+ 建议词 chips。镜面光标(DESIGN-SPEC §5):失焦时随文字移动并闪烁,
 * 聚焦时隐藏、交还原生 caret(caret-color 为 accent)。
 * 品牌语一行(M12 批②):后台可配 markdown(site_config home.hero_md)。2026-10-05
 * 性能批次:markdown 渲染移至服务端 HeroBrandLine(children 下传),本组件不再
 * 引 react-markdown——client bundle 甩掉 micromark 管线(~44KB gzip 首屏)。
 */
import Link from "next/link";
import { useRef } from "react";

/** 建议词(与站内内容强相关;点击进基础搜索) */
const SUGGESTIONS = [
  { icon: "i-fire", label: "Claude Code 实战", q: "Claude Code" },
  { icon: "i-book", label: "MCP 入门到实战", q: "MCP" },
  { icon: "i-tool", label: "本地部署 LLM", q: "本地部署" },
] as const;

export default function HeroConsole({
  postCount,
  children,
}: {
  postCount: number;
  /** 品牌语行(服务端 HeroBrandLine 渲染产物;h1 承载,SEO 落点不变) */
  children: React.ReactNode;
}): React.ReactElement {
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
    <section aria-label="站点控制台">
      <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-lg">
        <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-4 py-2.5">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          <span className="ml-2 font-mono text-xs text-text-3">17aitech — hub console</span>
        </div>
        <div className="px-5 pb-5 pt-4 font-mono text-[13.5px] leading-loose sm:px-8">
          <div className="whitespace-pre-wrap">
            <span className="text-green">➜</span> <span className="text-text-1">whoami</span>
          </div>
          {/* h1 承载品牌语(SEO 首页需 h1),视觉上即终端注释行;服务端渲染下传 */}
          <h1 className="whitespace-pre-wrap font-normal text-text-3">{children}</h1>
          <div className="whitespace-pre-wrap">
            <span className="text-accent-hi">hub.17aitech.com</span>{" "}
            <span className="text-text-3">--status=</span>
            <span className="text-green">active</span> <span className="text-text-3">--posts=</span>
            {postCount} <span className="text-text-3">--since=</span>2021
          </div>
          <form action="/search" method="get" role="search">
            <div className="mt-3 flex items-center gap-3 rounded-md border border-line bg-bg px-4 py-3 transition-colors focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-dim)]">
              <span className="flex-none text-base text-green">&gt;</span>
              <span className="relative flex min-w-0 flex-1 items-center">
                <span
                  ref={measureRef}
                  aria-hidden="true"
                  className="invisible absolute left-0 whitespace-pre font-mono text-[15px]"
                />
                <span
                  ref={caretRef}
                  aria-hidden="true"
                  className="q-caret pointer-events-none absolute left-0 h-[17px] w-[9px] bg-accent shadow-[0_0_8px_var(--glow)]"
                />
                <input
                  ref={inputRef}
                  type="text"
                  name="q"
                  placeholder="问点什么,或搜索资讯 / 教程 / 项目…"
                  autoComplete="off"
                  aria-label="搜索"
                  onInput={syncCaret}
                  onKeyUp={syncCaret}
                  onFocus={hideCaret}
                  onBlur={showCaret}
                  className="relative z-[1] w-full min-w-0 border-none bg-transparent font-mono text-[15px] text-text-1 outline-none caret-accent placeholder:text-text-3"
                />
              </span>
              <button
                type="submit"
                className="flex-none cursor-pointer rounded-sm border border-accent bg-accent px-3.5 py-1.5 font-mono text-[12.5px] text-white hover:border-accent-hover hover:bg-accent-hover"
              >
                问一下 ⏎
              </button>
            </div>
          </form>
        </div>
      </div>
      <div className="mt-3.5 flex flex-wrap gap-2.5">
        {SUGGESTIONS.map((s) => (
          <Link
            key={s.q}
            href={`/search?q=${encodeURIComponent(s.q)}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1.5 font-mono text-[12.5px] text-text-2 hover:border-line-hover hover:text-text-1"
          >
            <svg className="ic ic-sm" aria-hidden="true">
              <use href={`#${s.icon}`} />
            </svg>
            {s.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
