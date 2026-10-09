import Link from "next/link";

import { excerptOf } from "@/lib/content/format";
import { postPath } from "@/lib/content/post-path";
import { formatCnDate } from "@/lib/datetime";
import type { PostListItem } from "@/lib/content/posts";

/** 文章卡片(列表族共用):文字为主,利于移动端 LCP(验收 <2.5s) */
export default function PostCard({ post }: { post: PostListItem }): React.ReactElement {
  const excerpt = excerptOf(post);
  return (
    <article className="border-b border-line/60 py-5 last:border-b-0">
      <h2 className="text-lg font-semibold leading-snug">
        <Link href={postPath(post.id, post.slug)} className="hover:text-accent-hover">
          {post.title}
        </Link>
        {post.isPurchasable && (
          <span
            title="付费文章,解锁后阅读全文"
            className="ml-2 inline-block translate-y-[-1px] rounded-sm border border-accent/30 bg-accent/10 px-1.5 py-0.5 align-middle font-mono text-[11px] font-medium text-accent"
          >
            ¥ 付费
          </span>
        )}
      </h2>
      {excerpt ? <p className="mt-2 line-clamp-2 text-sm text-text-2">{excerpt}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-3">
        {post.publishedAt ? (
          <time dateTime={post.publishedAt.toISOString()}>{formatCnDate(post.publishedAt)}</time>
        ) : null}
        <Link
          href={`/category/${post.category.slug}/`}
          className="rounded bg-panel-2 px-1.5 py-0.5 hover:bg-line/40"
        >
          {post.category.name}
        </Link>
        {post.tags.map(({ tag }) => (
          <Link key={tag.slug} href={`/tag/${tag.slug}/`} className="hover:text-text-1">
            #{tag.name}
          </Link>
        ))}
        <span>阅读 {post.viewsCount.toLocaleString("zh-CN")}</span>
      </div>
    </article>
  );
}
