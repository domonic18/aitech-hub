import Link from "next/link";

import PaidBadge from "@/components/site/PaidBadge";
import CardCover, { CoverPlaceholder } from "@/components/site/CardCover";
import type { FeedItem } from "@/lib/content/article-feed";
import { excerptOf } from "@/lib/content/format";
import { asciiSlugFromTitle, pinPath } from "@/lib/content/pin-path";
import { postPath } from "@/lib/content/post-path";
import { formatCnDate } from "@/lib/datetime";

/** 元信息里露出多少个标签,其余折成 +n */
const MAX_TAGS = 3;
const EXCERPT_MAX = 160;

/**
 * 列表视图条目(2026-11-01 列表页重构):左文右缩略图的横向行,文章与贴图
 * 共用同一骨架。缩略图链接 aria-hidden/tabIndex=-1——可访问名由标题链接承担,
 * 否则读屏会把同一条内容念两遍。
 */
export default function ArticleRow({ item }: { item: FeedItem }): React.ReactElement {
  const isPost = item.kind === "post";
  const title = isPost ? item.post.title : item.pin.title;
  const href = isPost
    ? postPath(item.post.id, item.post.slug)
    : pinPath(item.pin.id, asciiSlugFromTitle(item.pin.title));
  const excerpt = isPost ? excerptOf(item.post) : item.pin.content.trim().slice(0, EXCERPT_MAX);
  const cover = isPost ? item.post.coverPath : item.pin.coverPath;
  const tags = isPost ? item.post.tags.map(({ tag }) => tag) : [];
  const shownTags = tags.slice(0, MAX_TAGS);
  const hiddenTagCount = tags.length - shownTags.length;

  return (
    <article className="flex gap-4 border-b border-line py-5 last:border-b-0 sm:gap-6">
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold leading-snug">
          <Link href={href} className="hover:text-accent-hover">
            {title}
          </Link>
          {isPost && item.post.isPurchasable && (
            <PaidBadge className="ml-2 inline-block translate-y-[-1px] align-middle" />
          )}
        </h2>
        {excerpt ? <p className="mt-2 line-clamp-2 text-sm text-text-2">{excerpt}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-3">
          <time dateTime={item.publishedAt.toISOString()}>{formatCnDate(item.publishedAt)}</time>
          {isPost ? (
            <>
              <Link
                href={`/category/${item.post.category.slug}/`}
                className="rounded bg-panel-2 px-1.5 py-0.5 hover:bg-line/40"
              >
                {item.post.category.name}
              </Link>
              {shownTags.map((tag) => (
                <Link key={tag.slug} href={`/tag/${tag.slug}/`} className="hover:text-text-1">
                  #{tag.name}
                </Link>
              ))}
              {hiddenTagCount > 0 ? <span>+{hiddenTagCount}</span> : null}
              <span>阅读 {item.post.viewsCount.toLocaleString("zh-CN")}</span>
              <span>评论 {item.post.commentCount}</span>
              <span>赞 {item.post.likeCount}</span>
            </>
          ) : (
            <span className="rounded bg-panel-2 px-1.5 py-0.5 text-text-2">
              贴图 · {item.pin.imageCount} 图
            </span>
          )}
        </div>
      </div>
      <Link
        href={href}
        aria-hidden="true"
        tabIndex={-1}
        className="w-24 shrink-0 self-start overflow-hidden rounded-md sm:w-44"
      >
        {cover ? (
          <CardCover src={cover} sizes="(max-width: 640px) 96px, 176px" />
        ) : (
          <CoverPlaceholder />
        )}
      </Link>
    </article>
  );
}
