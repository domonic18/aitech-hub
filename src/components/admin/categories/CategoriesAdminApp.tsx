"use client";

/**
 * 分类台账表(2026-10-16 后台增删改查):名称/slug/描述/排序/文章数/操作;
 * 删除守卫在 service(引用禁删/至少留一),in_use 报数透出服务端 message。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { CategoryAdminRow } from "@/lib/content/categories-admin";
import type { ApiEnvelope } from "@/lib/http/response";

import CategoryDialog from "./CategoryDialog";

const opLink = "cursor-pointer text-xs text-text-2 hover:text-accent disabled:opacity-50";

function Row({ category }: { category: CategoryAdminRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const remove = (): void => {
    const hint =
      category.postCount > 0
        ? `该分类下还有 ${category.postCount} 篇未删除文章,删除会被拒绝。`
        : "";
    if (!confirm(`确认删除分类「${category.name}」(${category.slug})?${hint}`)) return;
    setBusy(true);
    void (async () => {
      try {
        const res = await fetch(`/api/categories/${category.id}`, { method: "DELETE" });
        const body = (await res.json()) as ApiEnvelope;
        if (body.code !== 0) alert(body.message || `HTTP ${res.status}`);
        router.refresh();
      } catch (e) {
        alert(String(e));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <tr className="border-b border-line last:border-b-0 hover:bg-panel-2">
      <td className="px-4 py-2.5 font-medium text-text-1">{category.name}</td>
      <td
        className="px-3 py-2.5 font-mono text-[12px] text-text-1"
        title="/category/slug/ 公开页锚定,建后不可改"
      >
        {category.slug}
      </td>
      <td
        className="max-w-72 truncate px-3 py-2.5 text-xs text-text-2"
        title={category.description ?? ""}
      >
        {category.description ?? "—"}
      </td>
      <td className="px-3 py-2.5 font-mono text-[11px] text-text-3">{category.sortOrder}</td>
      <td className="px-3 py-2.5 font-mono text-[11px] text-text-3" title="不含回收站文章">
        {category.postCount}
      </td>
      <td className="px-4 py-2.5 text-right">
        <div className="flex justify-end gap-2.5">
          <CategoryDialog label="编辑" category={category} buttonClass={opLink} />
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className="cursor-pointer text-xs text-red hover:opacity-80 disabled:opacity-50"
          >
            删除
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function CategoriesAdminApp({ items }: { items: CategoryAdminRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-panel">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line bg-panel-2 text-xs text-text-2">
            <th className="px-4 py-2.5 font-medium">名称</th>
            <th className="px-3 py-2.5 font-medium">slug</th>
            <th className="px-3 py-2.5 font-medium">描述</th>
            <th className="px-3 py-2.5 font-medium">排序</th>
            <th className="px-3 py-2.5 font-medium">文章数</th>
            <th className="px-4 py-2.5 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <Row key={c.id} category={c} />
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-xs text-text-3">
                还没有分类,点右上角「新增分类」创建第一个
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="border-t border-line px-4 py-2.5 font-mono text-[11px] text-text-3">
        GET/POST /api/categories · PUT/DELETE /api/categories/[id] — slug 建后不可改(公开
        /category/&lt;slug&gt;/ 锚定);有未删除文章引用的分类不可删;至少保留一个分类
      </div>
    </div>
  );
}
