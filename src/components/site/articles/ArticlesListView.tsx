import type { ReactNode } from "react";

import Pagination from "@/components/site/Pagination";
import PostViewToggle from "@/components/site/PostViewToggle";
import type { FeedItem } from "@/lib/content/article-feed";

import ArticleCard from "./ArticleCard";
import ArticleRow from "./ArticleRow";

interface ArticlesListViewProps {
  heading: string;
  /** 副标题(缺省「共 N 篇」);/articles 页用来交代文章/贴图拆分 */
  description?: ReactNode;
  items: FeedItem[];
  total: number;
  page: number;
  pageSize: number;
  /** 列表根路径(如 /articles;第 1 页不带 page 段) */
  basePath: string;
  /** 自定义分页链接(搜索等 query 分页场景);默认 `${basePath}/page/N/` */
  pageHref?: (p: number) => string;
  /** 页头下方的筛选区(/articles 注入;分类/标签页无) */
  filterBar?: ReactNode;
}

function itemKey(item: FeedItem): string {
  return `${item.kind}-${item.kind === "post" ? item.post.id : item.pin.id}`;
}

/**
 * 列表族正文(2026-11-01 重构):全部文章/分类/标签共用,只换数据与分页链接。
 * 页头、筛选区、双视图条目、分页统一 `--site-max-w` 版心——此前页头 768、
 * 卡片视图 1200、列表视图 768 三套宽度互相错位(用户反馈问题 4 的根因)。
 * 双视图都是服务端渲染好的 ReactNode,切换只做显隐(PostViewToggle)。
 */
export default function ArticlesListView({
  heading,
  description,
  items,
  total,
  page,
  pageSize,
  basePath,
  pageHref,
  filterBar,
}: ArticlesListViewProps): React.ReactElement {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <section className="mx-auto w-full max-w-[var(--site-max-w)]">
      <header className="border-b border-line pb-4">
        <h1 className="text-2xl font-bold">{heading}</h1>
        <p className="mt-1 text-sm text-text-3">{description ?? `共 ${total} 篇`}</p>
      </header>
      {items.length === 0 ? (
        <>
          {filterBar ? <div className="mt-4">{filterBar}</div> : null}
          <p className="py-12 text-center text-text-3">暂无内容</p>
        </>
      ) : (
        <div className="mt-4">
          <PostViewToggle
            topBar={filterBar}
            list={
              <div>
                {items.map((item) => (
                  <ArticleRow key={itemKey(item)} item={item} />
                ))}
              </div>
            }
            cards={
              <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5">
                {items.map((item) => (
                  <ArticleCard key={itemKey(item)} item={item} />
                ))}
              </div>
            }
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
