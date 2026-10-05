import Link from "next/link";

import CardCover, { CoverPlaceholder } from "@/components/site/CardCover";
import { excerptOf } from "@/lib/content/format";
import { postPath } from "@/lib/content/post-path";
import { formatCnDate } from "@/lib/datetime";
import type { PostListItem } from "@/lib/content/posts";

/**
 * 封面卡片网格(M12 问题四,原型 site-articles 封面卡形态 + 行业惯例 2 列网格):
 * 与 PostCard 同数据(LIST_SELECT 已含 coverPath),封面 16:9,缺图/加载失败
 * 降级占位块保持行高一致;卡片视图由 PostViewToggle 客户端切换,本组件保持
 * Server Component。
 */
export default function PostCardGrid({ posts }: { posts: PostListItem[] }): React.ReactElement {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      {posts.map((post) => {
        const href = postPath(post.id, post.slug);
        const excerpt = excerptOf(post);
        return (
          <article
            key={post.id}
            className="overflow-hidden rounded-lg border border-line bg-panel shadow-sm transition-colors hover:border-line-hover"
          >
            <Link href={href} aria-label={post.title} className="block">
              {post.coverPath ? <CardCover src={post.coverPath} /> : <CoverPlaceholder />}
            </Link>
            <div className="p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Link
                  href={`/category/${post.category.slug}/`}
                  className="rounded bg-panel-2 px-1.5 py-0.5 text-text-2 hover:bg-line/40"
                >
                  {post.category.name}
                </Link>
                {post.tags.map(({ tag }) => (
                  <Link
                    key={tag.slug}
                    href={`/tag/${tag.slug}/`}
                    className="text-text-3 hover:text-text-1"
                  >
                    #{tag.name}
                  </Link>
                ))}
              </div>
              <h3 className="mt-2 line-clamp-2 text-base font-semibold leading-snug">
                <Link href={href} className="hover:text-accent-hover">
                  {post.title}
                </Link>
              </h3>
              {excerpt ? <p className="mt-2 line-clamp-2 text-sm text-text-2">{excerpt}</p> : null}
              <div className="mt-3 flex items-center gap-3 text-xs text-text-3">
                {post.publishedAt ? (
                  <time dateTime={post.publishedAt.toISOString()}>
                    {formatCnDate(post.publishedAt)}
                  </time>
                ) : null}
                <span>阅读 {post.viewsCount.toLocaleString("zh-CN")}</span>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
