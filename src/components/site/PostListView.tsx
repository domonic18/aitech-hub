import PostCard from "@/components/site/PostCard";
import PostCardGrid from "@/components/site/PostCardGrid";
import PostViewToggle from "@/components/site/PostViewToggle";
import Pagination from "@/components/site/Pagination";
import type { ReactNode } from "react";

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
  /** 头部下方的筛选条(/articles 注入 tag chips;其余页面无) */
  filterBar?: ReactNode;
}

/**
 * 列表族共用正文:全部文章/分类/标签/搜索结果同一渲染,只换数据与分页链接;
 * M12 问题四起条目区包 PostViewToggle(列表 ⇄ 封面卡片,客户端记忆)。
 */
export default function PostListView({
  heading,
  description,
  items,
  total,
  page,
  pageSize,
  basePath,
  pageHref,
  filterBar,
}: PostListViewProps): React.ReactElement {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    // 版心分两段:页头/筛选 768(阅读口径);视图区由 PostViewToggle 按视图
    // 切换版心(列表 768 / 卡片 --site-max-w,2026-10-05 反馈:卡片两列两侧太空)
    <section className="mx-auto w-full">
      <div className="mx-auto w-full max-w-3xl">
        <header className="border-b border-line/60 pb-4">
          <h1 className="text-2xl font-bold">{heading}</h1>
          <p className="mt-1 text-sm text-text-3">{description ?? `共 ${total} 篇`}</p>
        </header>
        {filterBar ? <div className="mt-4">{filterBar}</div> : null}
      </div>
      {items.length === 0 ? (
        <p className="mx-auto w-full max-w-3xl py-12 text-center text-text-3">暂无文章</p>
      ) : (
        <div className="mt-4">
          <PostViewToggle
            list={
              <div>
                {items.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
              </div>
            }
            cards={<PostCardGrid posts={items} />}
            footer={
              <Pagination
                page={page}
                totalPages={totalPages}
                hrefFor={
                  pageHref ?? ((p: number) => (p === 1 ? `${basePath}/` : `${basePath}/page/${p}/`))
                }
              />
            }
          />
        </div>
      )}
    </section>
  );
}
