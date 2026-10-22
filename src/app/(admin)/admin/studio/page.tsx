/**
 * 创作中心列表(M42:专题治理台泛化为创作中心,docs/plan M42):状态分段
 * (全部/收集中/已出稿/已发布,带计数)+ 主意图过滤(?output=)+ 创作表
 * (标题/主意图/状态/素材/更新时间)+ 新建表单。数据服务端直取 repo(不经 API);
 * 交互件在 components/admin/studio。
 */
import Link from "next/link";

import { parseListSegment, parsePage } from "@/lib/admin/list";
import { requireAdminPage } from "@/lib/auth/guard";
import { formatCnDateTime } from "@/lib/datetime";
import {
  TOPIC_LIST_SEGMENTS,
  TOPIC_OUTPUT_LABEL,
  TOPIC_OUTPUT_TYPES,
  TOPIC_STATUS_LABEL,
  type TopicOutputType,
  type TopicStatus,
} from "@/lib/topics/constants";
import { countByStatus, listTopics } from "@/lib/topics/repo";

import AdminPagination from "@/components/admin/AdminPagination";
import TopicCreateForm from "@/components/admin/studio/TopicCreateForm";

export const dynamic = "force-dynamic";

const STATUS_TONES: Record<TopicStatus, string> = {
  collecting: "bg-amber/12 text-amber-hi",
  drafted: "bg-panel-2 text-text-2",
  published: "bg-green/12 text-green",
};

/** 列表链接:叠加意图与状态两个过滤维,页码 >1 才带 */
function listHref(segment: string, output: TopicOutputType | undefined, page = 1): string {
  const params = new URLSearchParams();
  if (segment !== "all") params.set("status", segment);
  if (output) params.set("output", output);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/studio/?${qs}` : "/admin/studio/";
}

export default async function AdminStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; output?: string; page?: string }>;
}) {
  await requireAdminPage();
  const sp = await searchParams;
  const segment = parseListSegment(TOPIC_LIST_SEGMENTS, sp.status, "all");
  const output = (TOPIC_OUTPUT_TYPES as readonly string[]).includes(sp.output ?? "")
    ? (sp.output as TopicOutputType)
    : undefined;
  const page = parsePage(sp.page);
  const [{ items, total }, counts] = await Promise.all([
    listTopics({
      status: segment === "all" ? undefined : segment,
      ...(output ? { output } : {}),
      page,
    }),
    countByStatus(output),
  ]);
  const pages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">创作中心</h1>
        <TopicCreateForm />
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {TOPIC_LIST_SEGMENTS.map((s) => {
          const count =
            s === "all" ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[s] ?? 0);
          return (
            <Link
              key={s}
              href={listHref(s, output)}
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

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-mono text-[11px] text-text-3">主意图</span>
        <Link
          href={listHref(segment, undefined)}
          className={`rounded-sm px-2 py-0.5 text-xs ${
            output === undefined
              ? "bg-panel-2 font-medium text-text-1"
              : "text-text-2 hover:text-text-1"
          }`}
        >
          全部
        </Link>
        {TOPIC_OUTPUT_TYPES.map((o) => (
          <Link
            key={o}
            href={listHref(segment, o)}
            className={`rounded-sm px-2 py-0.5 text-xs ${
              output === o ? "bg-panel-2 font-medium text-text-1" : "text-text-2 hover:text-text-1"
            }`}
          >
            {TOPIC_OUTPUT_LABEL[o]}
          </Link>
        ))}
      </div>

      <div className="overflow-hidden rounded-sm border border-line">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-panel-2 text-xs text-text-2">
            <tr>
              <th className="px-3 py-2 font-medium">标题</th>
              <th className="px-3 py-2 font-medium">主意图</th>
              <th className="px-3 py-2 font-medium">状态</th>
              <th className="px-3 py-2 font-medium">素材</th>
              <th className="px-3 py-2 font-medium">更新时间</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => {
              const status = t.status as TopicStatus;
              const intent = t.outputType as TopicOutputType;
              return (
                <tr key={t.id.toString()} className="border-t border-line hover:bg-panel-2/60">
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/studio/${t.id.toString()}`}
                      className="text-text-1 hover:text-accent"
                    >
                      {t.title}
                    </Link>
                    {(t.positioning || t.pinPositioning) && (
                      <div className="mt-0.5 line-clamp-1 text-[11px] text-text-3">
                        {t.positioning || t.pinPositioning}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-2">
                    {TOPIC_OUTPUT_LABEL[intent] ?? t.outputType}
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
                <td colSpan={5} className="px-3 py-8 text-center text-text-3">
                  暂无创作——右上角「新建创作」开始,素材在视频解读完成或电报入库后挂载
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
          hrefFor={(p) => listHref(segment, output, p)}
        />
      )}
    </div>
  );
}
