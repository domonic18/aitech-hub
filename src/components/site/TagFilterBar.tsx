import Link from "next/link";

/**
 * tag 筛选条(M12 问题四,/articles 头部,原型 .filter-bar 形态):「全部」回
 * /articles/,各 tag 链到既有静态路由 /tag/<slug>/(ISR + canonical 不破);
 * 计数来自 listTagsWithCount()(已滤空标签)。
 */
export default function TagFilterBar({
  tags,
}: {
  tags: ReadonlyArray<{ slug: string; name: string; _count: { posts: number } }>;
}): React.ReactElement {
  if (tags.length === 0) return <div />;
  return (
    <nav aria-label="按标签筛选" className="flex flex-wrap gap-2">
      <Link
        href="/articles/"
        aria-current="true"
        className="rounded-full border border-accent bg-accent px-3 py-1 text-xs text-white"
      >
        全部
      </Link>
      {tags.map((t) => (
        <Link
          key={t.slug}
          href={`/tag/${t.slug}/`}
          className="rounded-full border border-line bg-panel px-3 py-1 text-xs text-text-2 hover:border-line-hover hover:text-text-1"
        >
          {t.name}
          <span className="ml-1.5 opacity-65">{t._count.posts}</span>
        </Link>
      ))}
    </nav>
  );
}
