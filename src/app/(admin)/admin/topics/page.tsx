/**
 * 专题治理台列表(M26 批③,docs/plan/topic-pipeline-plan.md §8):状态分段
 * (全部/收集中/已合成/已发布,带计数)+ 专题表(标题/状态/素材数/更新时间)
 * + 新建表单。数据服务端直取 repo(不经 API);交互件在 components/admin/topics。
 */
import Link from "next/link";

import { parseListSegment, parsePage } from "@/lib/admin/list";
import { requireAdminPage } from "@/lib/auth/guard";
import { formatCnDateTime } from "@/lib/datetime";
import { TOPIC_LIST_SEGMENTS, TOPIC_STATUS_LABEL, type TopicStatus } from "@/lib/topics/constants";
import { countByStatus, listTopics } from "@/lib/topics/repo";

import AdminPagination from "@/components/admin/AdminPagination";
import TopicCreateForm from "@/components/admin/topics/TopicCreateForm";

export const dynamic = "force-dynamic";

const STATUS_TONES: Record<TopicStatus, string> = {
  collecting: "bg-amber/12 text-amber-hi",
  drafted: "bg-panel-2 text-text-2",
  published: "bg-green/12 text-green",
};

function segmentHref(segment: string): string {
  return segment === "all" ? "/admin/topics/" : `/admin/topics/?status=${segment}`;
}

export default async function AdminTopicsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  await requireAdminPage();
  const sp = await searchParams;
  const segment = parseListSegment(TOPIC_LIST_SEGMENTS, sp.status, "all");
  const page = parsePage(sp.page);
  const [{ items, total }, counts] = await Promise.all([
    listTopics({ status: segment === "all" ? undefined : segment, page }),
    countByStatus(),
  ]);
  const pages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">专题管理</h1>
        <TopicCreateForm />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {TOPIC_LIST_SEGMENTS.map((s) => {
          const count =
            s === "all" ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[s] ?? 0);
          return (
            <Link
              key={s}
              href={segmentHref(s)}
              className={`rounded-sm px-2.5 py-1 text-xs font-medium ${
                s === segment
                  ? "bg-accent/12 text-accent"
                  : "border border-line text-text-2 hover:text-text-1"
              }`}
            >
              {s === "all" ? "全部" : TOPIC_STATUS_LABEL[s]}
              {` ${count}`}
            </Link>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-sm border border-line">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-panel-2 text-xs text-text-2">
            <tr>
              <th className="px-3 py-2 font-medium">标题</th>
              <th className="px-3 py-2 font-medium">状态</th>
              <th className="px-3 py-2 font-medium">素材</th>
              <th className="px-3 py-2 font-medium">更新时间</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => {
              const status = t.status as TopicStatus;
              return (
                <tr key={t.id.toString()} className="border-t border-line hover:bg-panel-2/60">
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/topics/${t.id.toString()}`}
                      className="text-text-1 hover:text-accent"
                    >
                      {t.title}
                    </Link>
                    {t.positioning && (
                      <div className="mt-0.5 line-clamp-1 text-[11px] text-text-3">
                        {t.positioning}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded-sm px-1.5 py-0.5 text-xs font-medium ${STATUS_TONES[status]}`}
                    >
                      {TOPIC_STATUS_LABEL[status] ?? t.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-text-2">{t._count.items}</td>
                  <td className="px-3 py-2 text-text-2">{formatCnDateTime(t.updatedAt)}</td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-text-3">
                  暂无专题——右上角「新建专题」开始,素材在视频解读完成后添加
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <AdminPagination
          page={page}
          totalPages={pages}
          total={total}
          hrefFor={(p) => {
            const params = new URLSearchParams();
            if (segment !== "all") params.set("status", segment);
            if (p > 1) params.set("page", String(p));
            const qs = params.toString();
            return qs ? `/admin/topics/?${qs}` : "/admin/topics/";
          }}
        />
      )}
    </div>
  );
}
