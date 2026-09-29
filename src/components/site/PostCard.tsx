import Link from "next/link";

import { excerptOf } from "@/lib/content/format";
import { formatCnDate } from "@/lib/datetime";
import type { PostListItem } from "@/lib/content/posts";

/** 文章卡片(列表族共用):文字为主,利于移动端 LCP(验收 <2.5s) */
export default function PostCard({ post }: { post: PostListItem }): React.ReactElement {
  const excerpt = excerptOf(post);
  return (
    <article className="border-b border-neutral-200/60 py-5 last:border-b-0">
      <h2 className="text-lg font-semibold leading-snug">
        <Link href={`/${post.slug}/`} className="hover:text-sky-700">
          {post.title}
        </Link>
      </h2>
      {excerpt ? <p className="mt-2 line-clamp-2 text-sm text-neutral-600">{excerpt}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
        {post.publishedAt ? (
          <time dateTime={post.publishedAt.toISOString()}>{formatCnDate(post.publishedAt)}</time>
        ) : null}
        <Link
          href={`/category/${post.category.slug}/`}
          className="rounded bg-neutral-100 px-1.5 py-0.5 hover:bg-neutral-200"
        >
          {post.category.name}
        </Link>
        {post.tags.map(({ tag }) => (
          <Link key={tag.slug} href={`/tag/${tag.slug}/`} className="hover:text-neutral-800">
            #{tag.name}
          </Link>
        ))}
        <span>阅读 {post.viewsCount.toLocaleString("zh-CN")}</span>
      </div>
    </article>
  );
}
