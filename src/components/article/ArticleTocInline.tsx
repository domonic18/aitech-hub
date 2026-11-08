import type { TocItem } from "@/lib/content/toc";

import TocLinks from "./TocLinks";

/**
 * 文章目录 · 移动/平板折叠块(2026-11-01):`<details>` 原生折叠,零 JS,
 * `xl` 起隐藏(该宽度以上由 ArticleToc 的吸顶侧栏接管)。
 * 默认收起 —— 移动端首屏优先给标题与正文。
 */
export default function ArticleTocInline({
  items,
  className,
}: {
  items: TocItem[];
  className?: string;
}): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <details
      className={`group rounded-md border border-line bg-panel-2 px-3 py-2 xl:hidden ${
        className ?? ""
      }`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-text-2">
        <span>文章目录 · {items.length} 节</span>
        <svg
          className="size-3.5 text-text-3 transition-transform group-open:rotate-180"
          aria-hidden
        >
          <use href="#i-caret-down" />
        </svg>
      </summary>
      <div className="mt-2 max-h-72 overflow-y-auto border-t border-line pt-2">
        <TocLinks items={items} />
      </div>
    </details>
  );
}
