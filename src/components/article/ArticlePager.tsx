import Link from "next/link";

import type { AdjacentPost } from "@/lib/content/posts";
import { postPath } from "@/lib/content/post-path";

/**
 * 文末上一篇 / 下一篇(2026-11-01 文章阅读页):
 * 语义同旧站 WP `previous_post_link` / `next_post_link` —— 上一篇 = 更早发布,
 * 下一篇 = 更新发布。链接一律经 postPath 构造(id 锚定终态 URL)。
 * 不带封面图:文章页 e2e 用 `article img` 统计正文图,这里保持纯文本卡。
 */
export default function ArticlePager({
  prev,
  next,
}: {
  prev: AdjacentPost | null;
  next: AdjacentPost | null;
}): React.ReactElement | null {
  if (!prev && !next) return null;

  const card =
    "group flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-panel px-4 py-3 transition-colors hover:border-line-hover";

  return (
    <nav aria-label="上一篇与下一篇" className="grid gap-3 sm:grid-cols-2">
      {prev ? (
        <Link href={postPath(prev.id, prev.slug)} className={card}>
          <span className="text-[11px] text-text-3">← 上一篇</span>
          <span className="line-clamp-2 text-sm font-medium text-text-1 group-hover:text-accent-hover">
            {prev.title}
          </span>
        </Link>
      ) : (
        <span aria-hidden />
      )}
      {next ? (
        <Link href={postPath(next.id, next.slug)} className={`${card} text-right`}>
          <span className="text-[11px] text-text-3">下一篇 →</span>
          <span className="line-clamp-2 text-sm font-medium text-text-1 group-hover:text-accent-hover">
            {next.title}
          </span>
        </Link>
      ) : null}
    </nav>
  );
}
