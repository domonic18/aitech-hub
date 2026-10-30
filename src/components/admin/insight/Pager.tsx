/**
 * 列表分页页脚(M59:信号独立页与实体视图共用):共 N 条 · page/pages +
 * 页码窗口(当前页居中、首尾恒在);单页时只留计数。
 */
import Link from "next/link";

import { pageWindow } from "@/lib/admin/list";

import { chipOff, chipOn } from "./shared";

export default function Pager({
  page,
  pages,
  total,
  hrefFor,
}: {
  page: number;
  pages: number;
  total: number;
  /** 第 N 页链接(各页自带筛选参数透传) */
  hrefFor: (page: number) => string;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
      <span className="font-mono text-[11px] text-text-3">
        共 {total.toLocaleString()} 条 · {page}/{pages} 页
      </span>
      {pages > 1 && (
        <div className="ml-auto flex items-center gap-1">
          {pageWindow(page, pages).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="px-1 font-mono text-[11px] text-text-3">
                …
              </span>
            ) : (
              <Link
                key={p}
                href={hrefFor(p)}
                scroll={false}
                aria-current={p === page ? "page" : undefined}
                className={p === page ? chipOn : chipOff}
              >
                {p}
              </Link>
            ),
          )}
        </div>
      )}
    </div>
  );
}
