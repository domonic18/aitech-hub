import Link from "next/link";

import PaidBadge from "@/components/site/PaidBadge";
import CardCover, { CoverPlaceholder } from "@/components/site/CardCover";
import type { FeedItem } from "@/lib/content/article-feed";
import { excerptOf } from "@/lib/content/format";
import { asciiSlugFromTitle, pinPath } from "@/lib/content/pin-path";
import { postPath } from "@/lib/content/post-path";
import { formatCnDate } from "@/lib/datetime";

const MAX_TAGS = 3;
const EXCERPT_MAX = 160;

/**
 * 卡片视图条目(2026-11-01 列表页重构):16:9 封面 + 标题/摘要/元信息,文章与
 * 贴图共用。`div.p-4` 是 e2e 判定卡片形态的锚点,勿改名。
 */
export default function ArticleCard({ item }: { item: FeedItem }): React.ReactElement {
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
    <article className="overflow-hidden rounded-lg border border-line bg-panel shadow-sm transition-colors hover:border-line-hover">
      <Link href={href} aria-label={title} className="relative block">
        {cover ? <CardCover src={cover} /> : <CoverPlaceholder />}
        {isPost ? null : (
          <span className="absolute right-2 top-2 rounded border border-line bg-panel/95 px-1.5 py-0.5 text-[11px] text-text-2">
            {item.pin.imageCount} 图
          </span>
        )}
      </Link>
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {isPost ? (
            <Link
              href={`/category/${item.post.category.slug}/`}
              className="rounded bg-panel-2 px-1.5 py-0.5 text-text-2 hover:bg-line/40"
            >
              {item.post.category.name}
            </Link>
          ) : (
            <span className="rounded bg-panel-2 px-1.5 py-0.5 text-text-2">贴图</span>
          )}
          {isPost && item.post.isPurchasable && <PaidBadge />}
          {shownTags.map((tag) => (
            <Link
              key={tag.slug}
              href={`/tag/${tag.slug}/`}
              className="text-text-3 hover:text-text-1"
            >
              #{tag.name}
            </Link>
          ))}
          {hiddenTagCount > 0 ? <span className="text-text-3">+{hiddenTagCount}</span> : null}
        </div>
        <h3 className="mt-2 line-clamp-2 text-base font-semibold leading-snug">
          <Link href={href} className="hover:text-accent-hover">
            {title}
          </Link>
        </h3>
        {excerpt ? <p className="mt-2 line-clamp-2 text-sm text-text-2">{excerpt}</p> : null}
        <div className="mt-3 flex items-center gap-3 text-xs text-text-3">
          <time dateTime={item.publishedAt.toISOString()}>{formatCnDate(item.publishedAt)}</time>
          {isPost ? (
            <>
              <span>阅读 {item.post.viewsCount.toLocaleString("zh-CN")}</span>
              <span>评论 {item.post.commentCount}</span>
              <span>赞 {item.post.likeCount}</span>
            </>
          ) : (
            <span>{item.pin.imageCount} 张图片</span>
          )}
        </div>
      </div>
    </article>
  );
}
