/**
 * 评论管理页(M23 批③,照 /admin/feedback 模板):三分段 tab(all/visible/
 * hidden,先发后审无 pending 段)+ 关键词搜索(内容/作者)+ 分页。表体客户端
 * 化(M31 验收反馈:多选批量删除,CommentsTable),本页留 tab/搜索/分页编排。
 * RSC 直调 listCommentsAdmin,不开列表 API。
 */
import Link from "next/link";

import { requireAdminPage } from "@/lib/auth/guard";
import {
  COMMENT_ADMIN_PAGE_SIZE,
  COMMENT_LIST_SEGMENTS,
  listCommentsAdmin,
  type CommentListSegment,
} from "@/lib/comment/comment-admin";
import { adminListHref, parseListSegment, parsePage } from "@/lib/admin/list";

import CommentsTable from "@/components/admin/CommentsTable";
import AdminPagination from "@/components/admin/AdminPagination";

export const dynamic = "force-dynamic";

const SEG_LABELS: Record<CommentListSegment, string> = {
  all: "全部",
  visible: "显示",
  hidden: "隐藏",
};

interface PageProps {
  searchParams: Promise<{ status?: string; page?: string; q?: string }>;
}

function listHref(segment: CommentListSegment, page: number, q?: string): string {
  return adminListHref("/admin/comments/", {
    status: segment === "all" ? undefined : segment,
    page,
    q,
  });
}

export default async function AdminCommentsPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  await requireAdminPage();
  const sp = await searchParams;
  const segment = parseListSegment(COMMENT_LIST_SEGMENTS, sp.status, "all");
  const page = parsePage(sp.page);
  const q = sp.q?.trim() || undefined;

  const { items, total, counts } = await listCommentsAdmin({ page, segment, q });
  const totalPages = Math.max(1, Math.ceil(total / COMMENT_ADMIN_PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">评论管理</h2>
        <p className="mt-0.5 text-xs text-text-3">
          先发后审:新评论即时可见,治理=隐藏(可恢复)/删根连带回复与点赞(物理不可逆)。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-sm border border-line">
          {COMMENT_LIST_SEGMENTS.map((seg) => (
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
          action="/admin/comments/"
          className="ml-auto flex w-full items-center gap-2 rounded-sm border border-line bg-panel px-2.5 py-1.5 focus-within:border-accent sm:w-auto"
        >
          <input type="hidden" name="status" value={segment} />
          <svg className="ic ic-sm text-text-3" aria-hidden="true">
            <use href="#i-search" />
          </svg>
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="搜索内容 / 作者…"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-text-3 sm:w-56"
          />
        </form>
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <CommentsTable items={items} />

        <AdminPagination
          page={page}
          totalPages={totalPages}
          total={total}
          hrefFor={(p) => listHref(segment, p, q)}
          unit="条"
        />
      </div>

      <p className="text-[11px] leading-relaxed text-text-3">
        说明:「WP」徽标 = 旧站迁移评论(作者名取 WP 原名留档);隐藏即时收敛(前台 client fetch 不经
        ISR);删除连带直接回复与两点赞表行。API:PUT/DELETE /api/post-comments/[id];批量删除 POST
        /api/post-comments/batch-delete。
      </p>
    </div>
  );
}
