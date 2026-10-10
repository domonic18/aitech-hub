/**
 * 反馈管理页(M22 批⑤,需求9):反馈 = 助手 submit_feedback 落库(Footer
 * 「联系我们」引导,游客/登录皆可)。四分段 tab + 关键词搜索 + 分页(users
 * 页同模式);行内状态流转 + 处理备注。无删除/无邮件通知(拍板口径:反馈是
 * 用户声音留档)。来源列空值兜底——归属经 sessionId 溯源会话表。
 */
import Link from "next/link";

import { requireAdminPage } from "@/lib/auth/guard";
import { formatCnDateTime } from "@/lib/datetime";
import {
  FEEDBACK_LIST_SEGMENTS,
  FEEDBACK_PAGE_SIZE,
  listFeedbackAdmin,
  type FeedbackListSegment,
} from "@/lib/feedback/feedback-admin";
import {
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_STATUS_LABELS,
  type FeedbackCategory,
  type FeedbackStatus,
} from "@/lib/feedback/feedback-schema";
import { adminListHref, parseListSegment, parsePage } from "@/lib/admin/list";

import FeedbackStatusControl from "@/components/admin/FeedbackStatusControl";
import AdminPagination from "@/components/admin/AdminPagination";

export const dynamic = "force-dynamic";

const SEG_LABELS: Record<FeedbackListSegment, string> = {
  all: "全部",
  open: "待处理",
  processing: "处理中",
  resolved: "已解决",
};

const CATEGORY_TONES: Record<FeedbackCategory, string> = {
  requirement: "bg-accent-dim text-accent",
  issue: "bg-red/12 text-red",
  suggestion: "bg-green/12 text-green",
  other: "bg-panel-2 text-text-2",
};

const STATUS_TONES: Record<FeedbackStatus, string> = {
  open: "bg-amber/12 text-amber-hi",
  processing: "bg-accent-dim text-accent",
  resolved: "bg-green/12 text-green",
};

interface PageProps {
  searchParams: Promise<{ status?: string; page?: string; q?: string }>;
}

function listHref(segment: FeedbackListSegment, page: number, q?: string): string {
  return adminListHref("/admin/feedback/", {
    status: segment === "all" ? undefined : segment,
    page,
    q,
  });
}

function CategoryChip({ category }: { category: string }) {
  const tone = CATEGORY_TONES[category as FeedbackCategory] ?? CATEGORY_TONES.other;
  const label = FEEDBACK_CATEGORY_LABELS[category as FeedbackCategory] ?? category;
  return (
    <span className={`inline-block rounded-sm px-1.5 py-0.5 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}

function StatusChip({ status }: { status: string }) {
  const tone = STATUS_TONES[status as FeedbackStatus] ?? STATUS_TONES.open;
  const label = FEEDBACK_STATUS_LABELS[status as FeedbackStatus] ?? status;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}

export default async function AdminFeedbackPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  await requireAdminPage();
  const sp = await searchParams;
  const segment = parseListSegment(FEEDBACK_LIST_SEGMENTS, sp.status, "all");
  const page = parsePage(sp.page);
  const q = sp.q?.trim() || undefined;

  const { items, total, counts } = await listFeedbackAdmin({ page, segment, q });
  const totalPages = Math.max(1, Math.ceil(total / FEEDBACK_PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">反馈管理</h2>
        <p className="mt-0.5 text-xs text-text-3">
          AI 助手「联系我们」引导落库;流转 open → processing → resolved,无删除(留档)。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-sm border border-line">
          {FEEDBACK_LIST_SEGMENTS.map((seg) => (
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
          action="/admin/feedback/"
          className="ml-auto flex w-full items-center gap-2 rounded-sm border border-line bg-panel px-2.5 py-1.5 focus-within:border-accent sm:w-auto"
        >
          <input type="hidden" name="status" value={segment} />
          <svg className="ic ic-sm text-text-3" aria-hidden="true">
            <use href="#i-search" />
          </svg>
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="搜索内容 / 联系方式 / 访客 id…"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-text-3 sm:w-56"
          />
        </form>
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-xs text-text-2">
              <th className="px-4 py-2.5 font-medium">分类</th>
              <th className="px-3 py-2.5 font-medium">内容</th>
              <th className="px-3 py-2.5 font-medium">联系方式</th>
              <th className="px-3 py-2.5 font-medium">来源</th>
              <th className="px-3 py-2.5 font-medium">状态</th>
              <th className="px-3 py-2.5 font-medium">提交时间</th>
              <th className="px-4 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((f) => (
              <tr key={f.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                <td className="px-4 py-2.5">
                  <CategoryChip category={f.category} />
                </td>
                <td className="max-w-[280px] px-3 py-2.5">
                  <div className="truncate text-text-1" title={f.content}>
                    {f.content}
                  </div>
                  {f.sessionId ? (
                    <div
                      className="mt-0.5 truncate font-mono text-[11px] text-text-3"
                      title={`会话 ${f.sessionId}`}
                    >
                      会话 {f.sessionId}
                    </div>
                  ) : null}
                </td>
                <td
                  className="max-w-[160px] truncate px-3 py-2.5 font-mono text-xs text-text-2"
                  title={f.contact ?? undefined}
                >
                  {f.contact ?? <span className="text-text-3">未留</span>}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-text-2">
                  {f.userId ? (
                    <span title={`uid ${f.userId}`}>uid {f.userId}</span>
                  ) : f.visitorId ? (
                    <span title={`游客 ${f.visitorId}`}>游客 {f.visitorId.slice(0, 8)}…</span>
                  ) : (
                    <span className="text-text-3">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <StatusChip status={f.status} />
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-text-2">
                  {formatCnDateTime(f.createdAt)}
                </td>
                <td className="px-4 py-2.5">
                  <FeedbackStatusControl id={f.id} status={f.status} adminNote={f.adminNote} />
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-xs text-text-3">
                  没有符合条件的反馈
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
        说明:处理备注随状态一起保存(空备注=清空);来源 uid=登录用户,游客按 ah_av 截短展示,
        完整归属经会话 id 在「会话管理」溯源。API:GET /api/feedback?page=&amp;status= · PUT
        /api/feedback/[id]。
      </p>
    </div>
  );
}
