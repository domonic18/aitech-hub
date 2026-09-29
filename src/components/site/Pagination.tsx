import Link from "next/link";

interface PaginationProps {
  page: number;
  totalPages: number;
  /** 第 p 页的链接(p 从 1 起) */
  hrefFor: (p: number) => string;
}

/** 分页(链接式,ISR 友好;窗口 ±2,首尾直达) */
export default function Pagination({
  page,
  totalPages,
  hrefFor,
}: PaginationProps): React.ReactElement | null {
  if (totalPages <= 1) return null;
  const windowStart = Math.max(1, Math.min(page - 2, totalPages - 4));
  const windowEnd = Math.min(totalPages, windowStart + 4);
  const pages = Array.from({ length: windowEnd - windowStart + 1 }, (_, i) => windowStart + i);
  const itemClass = "rounded-md px-2.5 py-1 hover:bg-neutral-100";
  const currentClass = "rounded-md bg-neutral-900 px-2.5 py-1 text-white";
  return (
    <nav
      aria-label="分页"
      className="mt-8 flex flex-wrap items-center justify-center gap-1 text-sm"
    >
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={itemClass} aria-label="上一页">
          上一页
        </Link>
      ) : null}
      {windowStart > 1 ? (
        <>
          <Link href={hrefFor(1)} className={itemClass}>
            1
          </Link>
          {windowStart > 2 ? <span className="px-1 text-neutral-400">…</span> : null}
        </>
      ) : null}
      {pages.map((p) => (
        <Link
          key={p}
          href={hrefFor(p)}
          className={p === page ? currentClass : itemClass}
          aria-current={p === page ? "page" : undefined}
        >
          {p}
        </Link>
      ))}
      {windowEnd < totalPages ? (
        <>
          {windowEnd < totalPages - 1 ? <span className="px-1 text-neutral-400">…</span> : null}
          <Link href={hrefFor(totalPages)} className={itemClass}>
            {totalPages}
          </Link>
        </>
      ) : null}
      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} className={itemClass} aria-label="下一页">
          下一页
        </Link>
      ) : null}
    </nav>
  );
}
