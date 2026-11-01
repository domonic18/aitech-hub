import Link from "next/link";

import type { PostListItem } from "@/lib/content/posts";
import { postPath } from "@/lib/content/post-path";
import { formatCnDate } from "@/lib/datetime";

import TrackedLink from "./TrackedLink";

/**
 * 右栏文章紧凑卡(2026-11-01 由首页私有组件抽出,首页与文章页右栏共用;
 * footerLink 省略即不渲染底栏)。首页传 `track` 记点击;文章页不传 —— 统计
 * 表 surface 枚举只有 home/telegram,不为文章页新增维度,该处渲染普通 Link。
 */
export default function PostRail({
  icon,
  title,
  tag,
  posts,
  footerLink,
  track,
}: {
  icon: string;
  title: string;
  tag: string;
  posts: PostListItem[];
  footerLink?: { href: string; label: string };
  track?: { surface: "home"; kind: "post" };
}): React.ReactElement {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-sm">
      <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-4 py-2.5 text-[13.5px] font-bold">
        <svg className="ic text-text-2" aria-hidden="true">
          <use href={icon} />
        </svg>
        {title}
        <span className="ml-auto font-mono text-[11px] font-normal tracking-wider text-text-3">
          [{tag}]
        </span>
      </div>
      {posts.map((post) => {
        const href = postPath(post.id, post.slug);
        const rowClass =
          "block border-b border-line/55 px-4 py-2.5 last:border-b-0 hover:bg-panel-2";
        const content = (
          <>
            <span className="block truncate text-[13px] font-semibold leading-normal text-text-1 hover:text-accent-hover">
              {post.title}
            </span>
            <span className="mt-1 flex items-center gap-2.5 font-mono text-[11.5px] text-text-3">
              <span className="rounded border border-green/30 bg-green/10 px-1.5 text-green-hi">
                {post.category.name}
              </span>
              {post.publishedAt ? <span>{formatCnDate(post.publishedAt).slice(5)}</span> : null}
              <span className="ml-auto inline-flex items-center gap-1">
                <svg className="ic ic-sm" aria-hidden="true">
                  <use href="#i-eye" />
                </svg>
                {post.viewsCount.toLocaleString("zh-CN")}
              </span>
            </span>
          </>
        );
        return track ? (
          <TrackedLink
            key={post.id}
            href={href}
            surface={track.surface}
            kind={track.kind}
            entryKey={post.id.toString()}
            className={rowClass}
          >
            {content}
          </TrackedLink>
        ) : (
          <Link key={post.id} href={href} className={rowClass}>
            {content}
          </Link>
        );
      })}
      {footerLink && (
        <div className="border-t border-line bg-panel-2 px-4 py-2 text-center">
          <Link href={footerLink.href} className="text-[13px] text-text-2 hover:text-accent-hover">
            {footerLink.label}
          </Link>
        </div>
      )}
    </div>
  );
}
