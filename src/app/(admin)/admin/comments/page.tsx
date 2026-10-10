/**
 * 评论管理页(M23 批③,照 /admin/feedback 模板):三分段 tab(all/visible/
 * hidden,先发后审无 pending 段)+ 关键词搜索(内容/作者)+ 分页。列:作者
 * (WP 迁移徽标)、内容、所属文章、楼层(根/回复)、状态、时间、操作
 * (隐藏/恢复/删根连带)。RSC 直调 listCommentsAdmin,不开列表 API。
 */
import Link from "next/link";

import { requireAdminPage } from "@/lib/auth/guard";
import { formatCnDateTime } from "@/lib/datetime";
import { postPath } from "@/lib/content/post-path";
import {
  COMMENT_ADMIN_PAGE_SIZE,
  COMMENT_LIST_SEGMENTS,
  listCommentsAdmin,
  type CommentListSegment,
} from "@/lib/comment/comment-admin";
import { COMMENT_STATUS_LABELS, type CommentStatus } from "@/lib/comment/comment-schema";
import { adminListHref, parseListSegment, parsePage } from "@/lib/admin/list";

import CommentStatusControl from "@/components/admin/CommentStatusControl";
import AdminPagination from "@/components/admin/AdminPagination";

export const dynamic = "force-dynamic";

const SEG_LABELS: Record<CommentListSegment, string> = {
  all: "全部",
  visible: "显示",
  hidden: "隐藏",
};

const STATUS_TONES: Record<CommentStatus, string> = {
  visible: "bg-green/12 text-green",
  hidden: "bg-amber/12 text-amber-hi",
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
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-xs text-text-2">
              <th className="px-4 py-2.5 font-medium">作者</th>
              <th className="px-3 py-2.5 font-medium">内容</th>
              <th className="px-3 py-2.5 font-medium">所属文章</th>
              <th className="px-3 py-2.5 font-medium">楼层</th>
              <th className="px-3 py-2.5 font-medium">状态</th>
              <th className="px-3 py-2.5 font-medium">时间</th>
              <th className="px-4 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1.5 text-text-1">
                    <span className="max-w-[120px] truncate" title={c.authorName}>
                      {c.authorName}
                    </span>
                    {c.migrated ? (
                      <span className="rounded-sm border border-line px-1 py-px font-mono text-[10px] text-text-3">
                        WP
                      </span>
                    ) : null}
                  </div>
                  {c.userId ? (
                    <div className="mt-0.5 font-mono text-[11px] text-text-3">uid {c.userId}</div>
                  ) : null}
                </td>
                <td className="max-w-[300px] px-3 py-2.5">
                  <div className="truncate text-text-1" title={c.content}>
                    {c.content}
                  </div>
                </td>
                <td className="max-w-[200px] truncate px-3 py-2.5">
                  <Link
                    href={postPath(BigInt(c.postId), c.postSlug)}
                    className="text-text-2 hover:text-accent"
                    title={c.postTitle}
                  >
                    {c.postTitle}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-xs text-text-2">
                  {c.parentId === null ? (
                    <span>
                      根
                      {c.replyCount > 0 ? (
                        <span className="ml-1 font-mono text-text-3">+{c.replyCount}</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-text-3">回复</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium ${STATUS_TONES[c.status] ?? ""}`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                    {COMMENT_STATUS_LABELS[c.status] ?? c.status}
                  </span>
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-text-2">
                  {formatCnDateTime(c.createdAt)}
                </td>
                <td className="px-4 py-2.5">
                  <CommentStatusControl id={c.id} status={c.status} replyCount={c.replyCount} />
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-xs text-text-3">
                  没有符合条件的评论
                </td>
              </tr>
            )}
          </tbody>
        </table>

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
        ISR);删除连带直接回复与两点赞表行。API:PUT/DELETE /api/post-comments/[id]。
      </p>
    </div>
  );
}
