"use client";

import { useEffect, useMemo, useState } from "react";

import type { TocItem } from "@/lib/content/toc";

import TocLinks from "./TocLinks";

/**
 * 文章目录 · 桌面吸顶侧栏(2026-11-01 文章阅读页优化):
 * SSR 直接输出完整链接列表(SEO/无 JS 可用),水合后只用 scroll 事件 + rAF
 * 计算「当前章节」并切换高亮 class —— 不动 DOM 结构,水合安全。
 *
 * 为什么不用 IntersectionObserver:目录项多时多观察器反而更绕,而「当前章节」
 * 的本质就是「最后一条越过吸顶 Header 的标题」,滚动位置一次算清,不会出现
 * 两条同时 intersecting 的歧义。监听器 passive + rAF 节流,单页开销可忽略。
 *
 * 壳宽度由父级 grid 决定(正文页 xl 三栏);自身只管吸顶偏移与高度上限。
 */
const ACTIVE_LINE = 96; // 吸顶 Header 64 + 32 呼吸,与 prose.css 的 scroll-margin 同口径

export default function ArticleToc({ items }: { items: TocItem[] }): React.ReactElement | null {
  const [activeId, setActiveId] = useState<string | null>(null);
  // items 是服务端产物,引用稳定;下标拼成 key 只为了 effect 依赖可比较
  const idsKey = useMemo(() => items.map((i) => i.id).join("|"), [items]);

  useEffect(() => {
    const ids = idsKey ? idsKey.split("|") : [];
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    let raf = 0;
    const update = (): void => {
      raf = 0;
      let current: string | null = els[0].id;
      for (const el of els) {
        if (el.getBoundingClientRect().top <= ACTIVE_LINE) current = el.id;
        else break;
      }
      setActiveId(current);
    };
    const onScroll = (): void => {
      if (raf) return;
      raf = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [idsKey]);

  if (items.length === 0) return null;

  return (
    <nav
      aria-label="文章目录"
      className="sticky top-[calc(var(--site-header-h)+16px)] hidden max-h-[calc(100vh-var(--site-header-h)-48px)] overflow-y-auto pb-4 xl:block"
    >
      <p className="mb-2 text-[11px] font-semibold tracking-wide text-text-3">目录</p>
      <TocLinks items={items} activeId={activeId} />
    </nav>
  );
}
