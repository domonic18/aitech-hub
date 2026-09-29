import PostCard from "@/components/site/PostCard";
import Pagination from "@/components/site/Pagination";
import type { PostListItem } from "@/lib/content/posts";

interface PostListViewProps {
  heading: string;
  description?: string;
  items: PostListItem[];
  total: number;
  page: number;
  pageSize: number;
  /** 列表根路径(如 /articles;第 1 页不带 page 段) */
  basePath: string;
  /** 自定义分页链接(搜索等 query 分页场景);默认 `${basePath}/page/N/` */
  pageHref?: (p: number) => string;
}

/** 列表族共用正文:全部文章/分类/标签/搜索结果同一渲染,只换数据与分页链接 */
export default function PostListView({
  heading,
  description,
  items,
  total,
  page,
  pageSize,
  basePath,
  pageHref,
}: PostListViewProps): React.ReactElement {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <section>
      <header className="border-b border-neutral-200/60 pb-4">
        <h1 className="text-2xl font-bold">{heading}</h1>
        <p className="mt-1 text-sm text-neutral-500">{description ?? `共 ${total} 篇`}</p>
      </header>
      {items.length === 0 ? (
        <p className="py-12 text-center text-neutral-500">暂无文章</p>
      ) : (
        <div>
          {items.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      )}
      <Pagination
        page={page}
        totalPages={totalPages}
        hrefFor={pageHref ?? ((p: number) => (p === 1 ? `${basePath}/` : `${basePath}/page/${p}/`))}
      />
    </section>
  );
}
