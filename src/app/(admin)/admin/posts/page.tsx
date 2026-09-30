/**
 * 文章管理列表(M5-a;原型 admin-posts.html):四分段 + 搜索 + 分页,整页服务端渲染;
 * 仅行内操作是客户端组件(发布/下架/软删成功后 router.refresh 重拉本页)。
 * 旧文保真:WP 迁移行底色区分,操作收敛为 查看/下架(无编辑/删除)。
 */
import Link from "next/link";

import ImportPostsButton from "@/components/admin/ImportPostsButton";
import PostRowOps from "@/components/admin/PostRowOps";
import PostStatusBadge from "@/components/admin/PostStatusBadge";
import {
  ADMIN_LIST_SEGMENTS,
  postDisplayState,
  type AdminListSegment,
} from "@/lib/content/post-schema";
import { ADMIN_PAGE_SIZE, listPostsAdmin } from "@/lib/content/posts-admin";
import { formatCnDateTime } from "@/lib/datetime";

export const dynamic = "force-dynamic";

const SEG_LABELS: Record<AdminListSegment, string> = {
  all: "全部",
  published: "已发布",
  draft: "草稿",
  unpublished: "已下架",
};

interface PageProps {
  searchParams: Promise<{ status?: string; page?: string; q?: string }>;
}

function parseSegment(raw: string | undefined): AdminListSegment {
  return (ADMIN_LIST_SEGMENTS as readonly string[]).includes(raw ?? "")
    ? (raw as AdminListSegment)
    : "all";
}

function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

function listHref(segment: AdminListSegment, page: number, q?: string): string {
  const params = new URLSearchParams();
  if (segment !== "all") params.set("status", segment);
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/posts/?${qs}` : "/admin/posts/";
}

/** 页码窗口(当前页居中,首尾恒在;null = 省略号) */
function pageWindow(cur: number, total: number): Array<number | null> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, cur - 1, cur, cur + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<number | null> = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push(null);
    out.push(p);
    prev = p;
  }
  return out;
}

export default async function AdminPostsPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const sp = await searchParams;
  const segment = parseSegment(sp.status);
  const page = parsePage(sp.page);
  const q = sp.q?.trim() || undefined;

  const { items, total, counts } = await listPostsAdmin({ page, segment, q });
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const hasLegacy = items.some((row) => row.wpPostId !== null);
  const pgBtn =
    "rounded-sm border border-line bg-panel px-2.5 py-1 font-mono text-xs text-text-2 hover:border-line-hover hover:text-text-1";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/posts/new"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          <svg className="ic" aria-hidden="true">
            <use href="#i-plus" />
          </svg>
          新建文章
        </Link>
        <ImportPostsButton />
        <div className="flex overflow-hidden rounded-sm border border-line">
          {ADMIN_LIST_SEGMENTS.map((seg) => (
            <Link
              key={seg}
              href={listHref(seg, 1, q)}
              className={`border-r border-line px-4 py-2 text-[13px] last:border-r-0 ${
                seg === segment
                  ? "bg-accent-dim font-semibold text-accent"
                  : "bg-panel text-text-2 hover:bg-panel-2"
              }`}
            >
              {SEG_LABELS[seg]} {counts[seg]}
            </Link>
          ))}
        </div>
        <form
          method="GET"
          action="/admin/posts/"
          className="ml-auto flex items-center gap-2 rounded-sm border border-line bg-panel px-2.5 py-1.5 focus-within:border-accent"
        >
          <input type="hidden" name="status" value={segment} />
          <svg className="ic ic-sm text-text-3" aria-hidden="true">
            <use href="#i-search" />
          </svg>
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="搜索标题 / slug…"
            className="w-44 bg-transparent text-[13px] outline-none placeholder:text-text-3"
          />
        </form>
      </div>

      {hasLegacy && (
        <div className="flex items-center gap-2 rounded-sm border border-line bg-panel-2 px-3 py-2 text-xs text-text-2">
          <svg className="ic text-amber" aria-hidden="true">
            <use href="#i-warning" />
          </svg>
          <span>
            <b className="text-text-1">旧文保真:</b>WP 迁移的历史文章正文为 HTML
            只读,编辑器内不可改写; 如需修改,请转 Markdown 重新发布(原 URL 不变,转 MD
            工作流随后续迭代交付)。
          </span>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-xs text-text-3">
              <th className="px-4 py-2.5 font-medium">文章</th>
              <th className="px-3 py-2.5 font-medium">分类 / 标签</th>
              <th className="px-3 py-2.5 font-medium">状态</th>
              <th className="px-3 py-2.5 text-right font-medium">浏览</th>
              <th className="px-3 py-2.5 font-medium">发布时间</th>
              <th className="px-4 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const state = postDisplayState(row);
              const legacy = row.wpPostId !== null;
              return (
                <tr
                  key={row.id.toString()}
                  className={`border-b border-line last:border-b-0 ${legacy ? "bg-panel-2" : ""}`}
                >
                  <td className="max-w-[420px] px-4 py-3">
                    <div
                      className={`truncate font-medium ${legacy ? "text-text-2" : "text-text-1"}`}
                    >
                      {row.title}
                      {legacy && (
                        <span className="ml-2 rounded-sm border border-line px-1 py-px align-middle text-[10px] text-text-3">
                          旧文保真
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-text-3">
                      /{row.slug} · {legacy ? "WP 迁移(HTML)" : "新建(Markdown)"}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className="rounded-sm bg-accent-dim px-1.5 py-0.5 text-[11px] text-accent">
                      {row.category.name}
                    </span>
                    {row.tags.map(({ tag }) => (
                      <span
                        key={tag.name}
                        className="ml-1 rounded-sm bg-panel-2 px-1.5 py-0.5 text-[11px] text-text-2"
                      >
                        {tag.name}
                      </span>
                    ))}
                  </td>
                  <td className="px-3 py-3">
                    <PostStatusBadge state={state} />
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs">
                    {row.viewsCount.toLocaleString("en-US")}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-text-2">
                    {row.publishedAt ? formatCnDateTime(row.publishedAt) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PostRowOps id={row.id.toString()} state={state} legacy={legacy} />
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs text-text-3">
                  没有符合条件的文章
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <span className="mr-auto text-xs text-text-3">
            共 {total.toLocaleString("en-US")} 篇 · 第 {page} / {totalPages} 页
          </span>
          {page > 1 && (
            <Link href={listHref(segment, page - 1, q)} className={pgBtn} aria-label="上一页">
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
              <Link key={p} href={listHref(segment, p, q)} className={pgBtn}>
                {p}
              </Link>
            ),
          )}
          {page < totalPages && (
            <Link href={listHref(segment, page + 1, q)} className={pgBtn} aria-label="下一页">
              ›
            </Link>
          )}
        </div>
      </div>

      <div className="font-mono text-[11px] text-text-3">
        GET /api/posts?status=&amp;page=(M5-c) · POST /api/posts · PUT /api/posts/[id] · POST
        /api/posts/[id]/publish|unpublish · DELETE 软删
      </div>
    </div>
  );
}
