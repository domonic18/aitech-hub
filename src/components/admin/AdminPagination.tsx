/**
 * admin 列表分页条(批C 从 telegram 页抽出):共 N 条 + 当前页/总页 + 页码窗口。
 * 链接由调用方的 hrefFor 生成(各页参数拼装规则不同),本件只管形态。
 */
import Link from "next/link";

import { pageWindow } from "@/lib/admin/list";

export default function AdminPagination({
  page,
  totalPages,
  total,
  hrefFor,
  unit = "条",
}: {
  page: number;
  totalPages: number;
  total: number;
  /** 页码 → 链接(跳页保持既有筛选;上一页/下一页/页码同一出处) */
  hrefFor: (p: number) => string;
  /** 计数单位(条/篇/位/项,各列表页口径) */
  unit?: string;
}) {
  const pgBtn =
    "rounded-sm border border-line bg-panel px-2.5 py-1 font-mono text-xs text-text-2 hover:border-line-hover hover:text-text-1";
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
      <span className="mr-auto text-xs text-text-3">
        共 {total.toLocaleString("en-US")} {unit} · 第 {page} / {totalPages} 页
      </span>
      {page > 1 && (
        <Link href={hrefFor(page - 1)} className={pgBtn} aria-label="上一页">
          ‹
        </Link>
      )}
      {pageWindow(page, totalPages).map((p, i) =>
        p === null ? (
          <span key={`gap-${i}`} className="text-xs text-text-3">
            …
          </span>
        ) : p === page ? (
          <span
            key={p}
            className="rounded-sm border border-accent bg-accent-dim px-2.5 py-1 font-mono text-xs font-semibold text-accent"
            aria-current="page"
          >
            {p}
          </span>
        ) : (
          <Link key={p} href={hrefFor(p)} className={pgBtn}>
            {p}
          </Link>
        ),
      )}
      {page < totalPages && (
        <Link href={hrefFor(page + 1)} className={pgBtn} aria-label="下一页">
          ›
        </Link>
      )}
    </div>
  );
}
