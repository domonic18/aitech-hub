"use client";

import { useEffect, useState } from "react";

/**
 * 回到顶部(2026-11-01 文章阅读页优化):
 * 长文滚过一屏后浮现。定位避让右下角 AI 助手(AssistantFab `bottom-5 right-4` z-40):
 * 本站房 `bottom-24`(96px)在其上方,`z-30` 低于助手,助手卡展开时自然盖住它。
 * 初始不可见由 JS 状态驱动(SSR 与首帧一致,水合安全);尊重 reduced-motion。
 */
const SHOW_AFTER = 600;

export default function BackToTop(): React.ReactElement {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let raf = 0;
    const update = (): void => {
      raf = 0;
      setVisible(window.scrollY > SHOW_AFTER);
    };
    const onScroll = (): void => {
      if (raf) return;
      raf = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  const toTop = (): void => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <button
      type="button"
      onClick={toTop}
      aria-label="回到顶部"
      title="回到顶部"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      className={`fixed bottom-24 right-4 z-30 flex size-10 cursor-pointer items-center justify-center rounded-full border border-line bg-panel text-text-2 shadow-md transition-opacity duration-200 hover:border-line-hover hover:text-text-1 sm:right-5 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <svg className="size-4 rotate-180" aria-hidden>
        <use href="#i-caret-down" />
      </svg>
    </button>
  );
}
