import Link from "next/link";

/** 展示多少个标签,其余折进「更多标签」 */
const TOP_TAGS = 10;

interface ChipItem {
  slug: string;
  name: string;
  _count: { posts: number };
}

/**
 * 底色/边框色必须整组切换:同一元素同时挂 `bg-panel` 与 `bg-accent` 时,
 * Tailwind 按工具类自身顺序出 CSS(bg-panel 在后),后者会赢,选中态与
 * 普通态外观一致(白底白字)。见 chipClass。
 */
const CHIP_BASE =
  "inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-xs transition-colors";
const CHIP = `${CHIP_BASE} border-line bg-panel text-text-2 hover:border-line-hover hover:text-text-1`;
const ACTIVE_CHIP = `${CHIP_BASE} border-accent bg-accent text-white`;

/**
 * 列表页筛选区(2026-11-01 重构):分类一行(稳定结构,解决「文章多了不好归类」),
 * 标签一行按文章数取 Top N + `<details>` 展开其余(解决标签越多筛选条越高)。
 * 零 JS;标签区保留 `nav aria-label="按标签筛选"`(e2e 锚点)。
 */
export default function ArticleFilterBar({
  categories,
  tags,
  postTotal,
}: {
  categories: ReadonlyArray<ChipItem>;
  tags: ReadonlyArray<ChipItem>;
  /** 「全部」chip 的计数(只数文章,与分类 chip 同口径) */
  postTotal: number;
}): React.ReactElement {
  const sortedTags = [...tags].sort(
    (a, b) => b._count.posts - a._count.posts || a.name.localeCompare(b.name, "zh-CN"),
  );
  const topTags = sortedTags.slice(0, TOP_TAGS);
  const restTags = sortedTags.slice(TOP_TAGS);

  return (
    <div className="rounded-lg border border-line bg-panel/60 p-3">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs text-text-3">分类</span>
        <div className="no-scrollbar flex flex-1 flex-wrap items-center gap-1.5 sm:flex-nowrap sm:overflow-x-auto">
          <Link href="/articles/" aria-current="page" className={ACTIVE_CHIP}>
            全部
            <span className="ml-1.5 opacity-65">{postTotal}</span>
          </Link>
          {categories.map((c) => (
            <Link key={c.slug} href={`/category/${c.slug}/`} className={CHIP}>
              {c.name}
              <span className="ml-1.5 opacity-65">{c._count.posts}</span>
            </Link>
          ))}
        </div>
      </div>

      <nav aria-label="按标签筛选" className="mt-2 flex items-start gap-2">
        <span className="shrink-0 pt-1 text-xs text-text-3">标签</span>
        <div className="min-w-0 flex-1">
          {tags.length === 0 ? (
            <p className="pt-1 text-xs text-text-3">暂无标签</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {topTags.map((t) => (
                  <Link key={t.slug} href={`/tag/${t.slug}/`} className={CHIP}>
                    {t.name}
                    <span className="ml-1.5 opacity-65">{t._count.posts}</span>
                  </Link>
                ))}
              </div>
              {restTags.length > 0 ? (
                <details className="group mt-1.5">
                  <summary className="inline-flex cursor-pointer list-none items-center rounded-full border border-line bg-panel px-3 py-1 text-xs text-text-3 transition-colors hover:border-line-hover hover:text-text-1">
                    更多标签 ({restTags.length})
                    <span className="ml-1.5 opacity-70 group-open:hidden">展开</span>
                    <span className="ml-1.5 hidden opacity-70 group-open:inline">收起</span>
                  </summary>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {restTags.map((t) => (
                      <Link key={t.slug} href={`/tag/${t.slug}/`} className={CHIP}>
                        {t.name}
                        <span className="ml-1.5 opacity-65">{t._count.posts}</span>
                      </Link>
                    ))}
                  </div>
                </details>
              ) : null}
            </>
          )}
        </div>
      </nav>
    </div>
  );
}
