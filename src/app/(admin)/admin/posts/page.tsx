/**
 * 文章管理列表(M5-a;原型 admin-posts.html):四分段 + 搜索 + 分页,整页服务端渲染。
 * 表格主体是客户端组件 PostsTable(M16 问题8:行多选 + 批量 SEO 补全),本页只做
 * 数据编排与瘦身映射(不把 contentMd 等重字段传给客户端);分页以 children 注入
 * (AdminPagination 需服务端 hrefFor)。旧文保真:WP 迁移行底色区分,操作收敛为
 * 查看/下架(无编辑/删除)。
 */
import Link from "next/link";

import ImportPostsButton from "@/components/admin/ImportPostsButton";
import PostsTable from "@/components/admin/PostsTable";
import {
  ADMIN_LIST_SEGMENTS,
  postDisplayState,
  type AdminListSegment,
} from "@/lib/content/post-schema";
import { ADMIN_PAGE_SIZE, listPostsAdmin } from "@/lib/content/posts-admin";
import { postPath, postPathSegment } from "@/lib/content/post-path";
import { isWechatReady } from "@/lib/distribute/wechat-config-admin";
import { adminListHref, parseListSegment, parsePage } from "@/lib/admin/list";
import AdminPagination from "@/components/admin/AdminPagination";

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

function listHref(segment: AdminListSegment, page: number, q?: string): string {
  return adminListHref("/admin/posts/", {
    status: segment === "all" ? undefined : segment,
    page,
    q,
  });
}

export default async function AdminPostsPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const sp = await searchParams;
  const segment = parseListSegment(ADMIN_LIST_SEGMENTS, sp.status, "all");
  const page = parsePage(sp.page);
  const q = sp.q?.trim() || undefined;

  const [{ items, total, counts }, wechatReady] = await Promise.all([
    listPostsAdmin({ page, segment, q }),
    isWechatReady(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  // M5-d 回填后旧文均可编辑,仅当仍存在未转 MD 的 WP 行才提示保真只读
  const hasLegacy = items.some((row) => row.wpPostId !== null && !row.contentMd);

  // 客户端行视图瘦身:id/path 提前在服务端定形(bigint 不跨界),tags 拍平名字
  const rows = items.map((row) => ({
    id: row.id.toString(),
    title: row.title,
    state: postDisplayState(row),
    legacy: row.wpPostId !== null,
    pathSegment: postPathSegment(row.id, row.slug),
    sitePath: postPath(row.id, row.slug),
    categoryName: row.category.name,
    tagNames: row.tags.map(({ tag }) => tag.name),
    viewsCount: Number(row.viewsCount),
    publishedAt: row.publishedAt,
    coverPath: row.coverPath,
    seoTitle: row.seoTitle,
    excerpt: row.excerpt,
    seoDescription: row.seoDescription,
    syncable: row.contentMd !== null,
    wechat: row.channels.find((c) => c.channel === "wechat") ?? null,
  }));

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
          className="ml-auto flex w-full items-center gap-2 rounded-sm border border-line bg-panel px-2.5 py-1.5 focus-within:border-accent sm:w-auto"
        >
          <input type="hidden" name="status" value={segment} />
          <svg className="ic ic-sm text-text-3" aria-hidden="true">
            <use href="#i-search" />
          </svg>
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="搜索标题 / slug…"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-text-3 sm:w-44"
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

      <PostsTable rows={rows} wechatReady={wechatReady}>
        <AdminPagination
          page={page}
          totalPages={totalPages}
          total={total}
          hrefFor={(p) => listHref(segment, p, q)}
          unit="篇"
        />
      </PostsTable>

      <div className="font-mono text-[11px] text-text-3">
        GET /api/posts?status=&amp;page=(M5-c) · POST /api/posts · PUT /api/posts/[id] · POST
        /api/posts/[id]/publish|unpublish · DELETE 软删 · POST /api/posts/seo-suggest-batch(M16)
      </div>
    </div>
  );
}
