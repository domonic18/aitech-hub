import type { TocItem } from "@/lib/content/toc";

/**
 * 目录链接列表(纯展示,无 hooks):桌面 sticky 侧栏(client,带当前章节高亮)
 * 与移动折叠块(server)共用同一套排版,避免两套样式漂移。
 * `TocItem` 只做类型导入,本件不会把 markdown 解析链带进 client chunk。
 */
export default function TocLinks({
  items,
  activeId,
}: {
  items: TocItem[];
  activeId?: string | null;
}): React.ReactElement {
  return (
    <ul className="space-y-0.5 text-[12.5px] leading-snug">
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <li key={item.id} className={item.level === 3 ? "pl-3" : undefined}>
            <a
              href={`#${item.id}`}
              title={item.text}
              aria-current={active ? "location" : undefined}
              className={`block rounded-sm border-l-2 py-1 pl-2.5 pr-2 transition-colors ${
                active
                  ? "border-accent bg-accent-dim font-semibold text-accent-hover"
                  : "border-transparent text-text-3 hover:border-line hover:text-text-1"
              }`}
            >
              <span className="line-clamp-2">{item.text}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
