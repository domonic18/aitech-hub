import Link from "next/link";

import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { countPublishedPosts, listLatestPosts, listPinnedPosts } from "@/lib/content/posts";
import { formatCnDate } from "@/lib/datetime";

import HeroConsole from "@/components/site/HeroConsole";
import PostCard from "@/components/site/PostCard";
import SiteSprite from "@/components/site/SiteSprite";

/**
 * 首页 Hub(M5-e 布局壳,原型 site-home;arch/07-frontend §1:ISR 600s):
 * 终端 hero + 左主轴博主文章流 + 右栏(精选/GEO)。电报流与 GitHub 项目区按原型
 * 「三区可独立降级」不渲染(二期数据接入;首页为 SEO 第一页面,不落空壳 DOM),
 * 左栏区块头挂显式降级注记(DESIGN-SPEC §6)。
 */
export const revalidate = 600;

export default async function HomePage(): Promise<React.ReactElement> {
  const [pinned, latest, postCount] = await Promise.all([
    listPinnedPosts(5),
    listLatestPosts(DEFAULT_PAGE_SIZE),
    countPublishedPosts(),
  ]);

  return (
    <div className="mx-auto w-full max-w-[var(--site-max-w)]">
      <SiteSprite />
      <HeroConsole postCount={postCount} />

      <div className="mt-7 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* 左主轴:博主文章流(电报流二期接入,显式降级注记) */}
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="font-mono text-sm font-semibold text-text-2">$ ls -la /articles</h2>
            <span className="rounded-sm border border-line px-2 py-0.5 font-mono text-[11px] text-text-3">
              电报流 · 二期接入
            </span>
            <Link
              href="/articles/"
              className="ml-auto whitespace-nowrap text-[13px] text-text-2 hover:text-accent-hover"
            >
              全部文章 →
            </Link>
          </div>
          <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-sm [&>article]:px-5">
            {latest.map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>
        </section>

        {/* 右栏:精选 + GEO(GitHub 项目卡二期接入,同批降级) */}
        <aside className="flex min-w-0 flex-col gap-4">
          {pinned.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-sm">
              <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-4 py-2.5 text-[13.5px] font-bold">
                <svg className="ic text-text-2" aria-hidden="true">
                  <use href="#i-star" />
                </svg>
                精选
                <span className="ml-auto font-mono text-[11px] font-normal tracking-wider text-text-3">
                  [PINNED]
                </span>
              </div>
              {pinned.map((post) => (
                <Link
                  key={post.slug}
                  href={`/${post.slug}/`}
                  className="block border-b border-line/55 px-4 py-2.5 last:border-b-0 hover:bg-panel-2"
                >
                  <span className="block truncate text-[13px] font-semibold leading-normal hover:text-accent-hover">
                    {post.title}
                  </span>
                  <span className="mt-1 flex items-center gap-2.5 font-mono text-[11.5px] text-text-3">
                    <span className="rounded border border-green/30 bg-green/10 px-1.5 text-green-hi">
                      {post.category.name}
                    </span>
                    {post.publishedAt ? <span>{formatCnDate(post.publishedAt)}</span> : null}
                    <span className="ml-auto inline-flex items-center gap-1">
                      <svg className="ic ic-sm" aria-hidden="true">
                        <use href="#i-eye" />
                      </svg>
                      {post.viewsCount.toLocaleString("zh-CN")}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}
          <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-sm">
            <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-4 py-2.5 text-[13.5px] font-bold">
              <svg className="ic text-text-2" aria-hidden="true">
                <use href="#i-robot" />
              </svg>
              给人,也给智能体
              <span className="ml-auto font-mono text-[11px] font-normal tracking-wider text-text-3">
                [GEO]
              </span>
            </div>
            <div className="px-4 pb-3.5 pt-3">
              <p className="text-xs leading-relaxed text-text-2">
                全站内容对机器友好:llms.txt 索引、每篇文章 Markdown 直出、站点内容 MCP(二期)。AI
                助手引用即流量。
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {["/llms.txt", "/llms-full.txt", "/feed.xml"].map((href) => (
                  <a
                    key={href}
                    href={href}
                    className="rounded border border-blue/25 bg-blue/10 px-2 py-0.5 font-mono text-[11px] text-blue hover:bg-blue/20"
                  >
                    {href}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
