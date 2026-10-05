/**
 * 媒体库(原型 admin-media.html):统计卡 + kind Tab × 引用过滤 + 网格 + 分页,整页服务端渲染;
 * 引用状态实时计算(refs+cover 双查),audit 定时任务仅作持久投影。
 * 仅上传/体检/勾选/抽屉是客户端组件(MediaActions / MediaGrid)。
 */
import Link from "next/link";

import MediaActions from "@/components/admin/MediaActions";
import MediaDupeList from "@/components/admin/MediaDupeList";
import MediaGrid from "@/components/admin/MediaGrid";
import { MEDIA_AUDIT_CRON } from "@/lib/queue";
import {
  type MediaKind,
  type MediaRefFilter,
  MEDIA_KINDS,
  MEDIA_LIMITS,
  MEDIA_REF_FILTERS,
  formatBytes,
  parseKind,
  parseRefFilter,
} from "@/lib/media/media-schema";
import {
  MEDIA_PAGE_SIZE,
  brokenRefs,
  listDupeGroups,
  listMediaAdmin,
  mediaStats,
} from "@/lib/media/queries";
import { parsePage } from "@/lib/admin/list";
import AdminPagination from "@/components/admin/AdminPagination";

export const dynamic = "force-dynamic";

/** Record 全键标签表:域枚举扩项时编译期强制补文案(评审 W3) */
const KIND_LABELS: Record<MediaKind, string> = { image: "图片", video: "视频", file: "文件" };
const REF_LABELS: Record<MediaRefFilter, string> = {
  all: "全部",
  referenced: "已引用",
  orphan: "未引用",
};

interface PageProps {
  searchParams: Promise<{ kind?: string; ref?: string; q?: string; page?: string }>;
}

function listHref(kind: string, refFilter: string, page: number, q?: string): string {
  const params = new URLSearchParams();
  if (kind !== "image") params.set("kind", kind);
  if (refFilter !== "all") params.set("ref", refFilter);
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/media/?${qs}` : "/admin/media/";
}

export default async function AdminMediaPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const sp = await searchParams;
  const kind = parseKind(sp.kind);
  const refFilter = parseRefFilter(sp.ref);
  const q = sp.q?.trim() || undefined;
  const page = parsePage(sp.page);

  const [list, stats, broken, dupes] = await Promise.all([
    listMediaAdmin({ kind, refFilter, q, page }),
    mediaStats(),
    brokenRefs(),
    listDupeGroups(),
  ]);
  const totalPages = Math.max(1, Math.ceil(list.total / MEDIA_PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {MEDIA_KINDS.map((k) => (
          <div key={k} className="rounded-md border border-line bg-panel px-4 py-3">
            <div className="text-xs text-text-3">{KIND_LABELS[k]}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-semibold">{stats.kinds[k].count}</span>
              <span className="font-mono text-[11px] text-text-3">
                {formatBytes(stats.kinds[k].bytes)}
              </span>
            </div>
          </div>
        ))}
        <div className="rounded-md border border-line bg-panel px-4 py-3">
          <div className="text-xs text-text-3">近 30 天 / 未引用</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold">{stats.last30d.count}</span>
            <span className="font-mono text-[11px] text-text-3">
              {formatBytes(stats.last30d.bytes)}
            </span>
            <span
              className={`ml-auto font-mono text-sm ${stats.orphanCount > 0 ? "text-amber" : "text-text-3"}`}
            >
              孤儿 {stats.orphanCount}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <MediaActions />
        <div className="flex overflow-hidden rounded-sm border border-line">
          {MEDIA_KINDS.map((k) => (
            <Link
              key={k}
              href={listHref(k, refFilter, 1, q)}
              className={`border-r border-line px-4 py-2 text-[13px] last:border-r-0 ${
                k === kind
                  ? "bg-accent-dim font-semibold text-accent"
                  : "bg-panel text-text-2 hover:bg-panel-2"
              }`}
            >
              {KIND_LABELS[k]} {list.counts[k].all}
            </Link>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-sm border border-line">
          {MEDIA_REF_FILTERS.map((f) => (
            <Link
              key={f}
              href={listHref(kind, f, 1, q)}
              className={`border-r border-line px-3 py-2 text-[13px] last:border-r-0 ${
                f === refFilter
                  ? "bg-accent-dim font-semibold text-accent"
                  : "bg-panel text-text-2 hover:bg-panel-2"
              }`}
            >
              {REF_LABELS[f]}
            </Link>
          ))}
        </div>
        <form
          method="GET"
          action="/admin/media/"
          className="ml-auto flex w-full items-center gap-2 rounded-sm border border-line bg-panel px-2.5 py-1.5 focus-within:border-accent sm:w-auto"
        >
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="ref" value={refFilter} />
          <svg className="ic ic-sm text-text-3" aria-hidden="true">
            <use href="#i-search" />
          </svg>
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="搜索文件名 / sha1…"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-text-3 sm:w-44"
          />
        </form>
      </div>

      {refFilter === "orphan" && (
        <div className="flex items-center gap-2 rounded-sm border border-line bg-panel-2 px-3 py-2 text-xs text-text-2">
          <svg className="ic text-amber" aria-hidden="true">
            <use href="#i-warning" />
          </svg>
          <span>
            未引用 = 无文章正文/封面引用;勾选后可批量删除(被引用的会自动跳过)。软删入回收站,
            {MEDIA_LIMITS.trashDays} 天后物理清除。
          </span>
        </div>
      )}

      {broken.length > 0 && (
        <div className="flex items-center gap-2 rounded-sm border border-line bg-panel-2 px-3 py-2 text-xs text-text-2">
          <svg className="ic text-red" aria-hidden="true">
            <use href="#i-warning" />
          </svg>
          <span>
            断链 <b className="text-red">{broken.length}</b> 处(库/盘里已无文件):{" "}
            <span className="break-all font-mono text-[11px]">
              {broken
                .slice(0, 3)
                .map((b) => `${b.path}(${b.posts} 篇)`)
                .join("、")}
              {broken.length > 3 ? " …" : ""}
            </span>
          </span>
        </div>
      )}

      {/* 重复检测分组视图(原型 .dupe-row;同 sha1 ≥2 条即整卡呈现,无重复不占位) */}
      {dupes.length > 0 && <MediaDupeList groups={dupes} />}

      <MediaGrid items={list.items} refFilter={refFilter} />

      <AdminPagination
        page={page}
        totalPages={totalPages}
        total={list.total}
        hrefFor={(p) => listHref(kind, refFilter, p, q)}
        unit="项"
      />

      <div className="font-mono text-[11px] text-text-3">
        POST /api/media · GET/DELETE /api/media/[id] · POST /api/media/import|batch-delete|audit ·
        POST /api/media/dupes/merge · audit cron {MEDIA_AUDIT_CRON}
      </div>
    </div>
  );
}
