/**
 * 创作中心列表(v2 交互重构):状态分段(带计数)+ 主意图过滤 + 标题检索
 * (?q=,GET 表单服务端渲染)+ 3 列创作卡(进度 chips:素材/长文/贴图)。
 * 数据服务端直取 repo(不经 API);交互件在 components/admin/studio。
 */
import Link from "next/link";

import { parseListSegment, parsePage } from "@/lib/admin/list";
import { requireAdminPage } from "@/lib/auth/guard";
import {
  TOPIC_LIST_SEGMENTS,
  TOPIC_OUTPUT_LABEL,
  TOPIC_OUTPUT_TYPES,
  TOPIC_STATUS_LABEL,
  type TopicOutputType,
} from "@/lib/topics/constants";
import { countByStatus, listTopics, pinCountByTopic } from "@/lib/topics/repo";

import AdminPagination from "@/components/admin/AdminPagination";
import TopicCreateForm from "@/components/admin/studio/TopicCreateForm";
import TopicCreationCards from "@/components/admin/studio/TopicCreationCards";

export const dynamic = "force-dynamic";

/** 列表链接:叠加状态/主意图/关键词三个过滤维,页码 >1 才带页码 */
function listHref(
  segment: string,
  output: TopicOutputType | undefined,
  q: string,
  page = 1,
): string {
  const params = new URLSearchParams();
  if (segment !== "all") params.set("status", segment);
  if (output) params.set("output", output);
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/studio/?${qs}` : "/admin/studio/";
}

export default async function AdminStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; output?: string; q?: string; page?: string }>;
}) {
  await requireAdminPage();
  const sp = await searchParams;
  const segment = parseListSegment(TOPIC_LIST_SEGMENTS, sp.status, "all");
  const output = (TOPIC_OUTPUT_TYPES as readonly string[]).includes(sp.output ?? "")
    ? (sp.output as TopicOutputType)
    : undefined;
  const q = sp.q?.trim() ?? "";
  const page = parsePage(sp.page);
  const [{ items, total }, counts] = await Promise.all([
    listTopics({
      status: segment === "all" ? undefined : segment,
      ...(output ? { output } : {}),
      ...(q ? { q } : {}),
      page,
    }),
    countByStatus(output),
  ]);
  const pinCounts = await pinCountByTopic(items.map((t) => t.id));
  const pages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="mx-auto max-w-6xl">
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
              href={listHref(s, output, q)}
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

        <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />
        <Link
          href={listHref(segment, undefined, q)}
          className={`rounded-sm px-2 py-1 text-xs ${
            output === undefined
              ? "bg-panel-2 font-medium text-text-1"
              : "text-text-2 hover:text-text-1"
          }`}
        >
          全部产出
        </Link>
        {TOPIC_OUTPUT_TYPES.map((o) => (
          <Link
            key={o}
            href={listHref(segment, o, q)}
            className={`rounded-sm px-2 py-1 text-xs ${
              output === o ? "bg-panel-2 font-medium text-text-1" : "text-text-2 hover:text-text-1"
            }`}
          >
            {TOPIC_OUTPUT_LABEL[o]}
          </Link>
        ))}

        {/* 标题检索:GET 表单服务端渲染,隐藏域保持既有筛选 */}
        <form action="/admin/studio/" method="get" className="ml-auto flex items-center gap-1.5">
          {segment !== "all" && <input type="hidden" name="status" value={segment} />}
          {output && <input type="hidden" name="output" value={output} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="搜创作标题,回车检索…"
            className="w-56 rounded-sm border border-line bg-panel px-2.5 py-1 text-[12px] outline-none focus:border-accent placeholder:text-text-3"
          />
        </form>
      </div>

      <TopicCreationCards topics={items} pinCounts={pinCounts} />

      {pages > 1 && (
        <AdminPagination
          page={page}
          totalPages={pages}
          total={total}
          hrefFor={(p) => listHref(segment, output, q, p)}
        />
      )}
    </div>
  );
}
