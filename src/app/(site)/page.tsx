import Link from "next/link";

import { countPublishedPosts, listLatestPosts } from "@/lib/content/posts";
import { postPath } from "@/lib/content/post-path";
import { getBandItemCount, getHeroMd, getPostCount, getRepoCount } from "@/lib/config/site-config";
import { formatCnDate } from "@/lib/datetime";
import { formatStars, listShowcaseRepos } from "@/lib/github/public";
import { projectPath } from "@/lib/github/project-path";
import { countTodayVisible, listBandFeed, listPublicChannels } from "@/lib/telegram/public-feed";

import HeroConsole from "@/components/site/HeroConsole";
import SiteSprite from "@/components/site/SiteSprite";
import TelegramBand from "@/components/site/TelegramBand";

/**
 * 首页 Hub(原型 site-home v0.5.0 双栏仪表盘;arch/07-frontend §1:ISR 600s):
 * 终端 hero + hub-grid(左主轴=电报流 LIVE 带;右栏=开源项目卡 + 博主文章紧凑卡 +
 * GEO)。电报带/项目/文章条数与 hub 主文案后台可配(M10/M12,site_config,保存后
 * on-demand revalidate 本页);客户端 60s 轮询(M7 批⑤;下滚加载更多 M10 已于
 * 2026-10-05 移除,带内固定一页)。
 * GitHub 项目卡 M11:白名单空(全部下架)整卡不渲染,「三区可独立降级」。
 */
export const revalidate = 600;

export default async function HomePage(): Promise<React.ReactElement> {
  // 先取配置(rail 条数是后续取数的入参),再并行取数据
  const [bandCount, heroMd, railPostCount, railRepoCount, today, channels] = await Promise.all([
    getBandItemCount(),
    getHeroMd(),
    getPostCount(),
    getRepoCount(),
    countTodayVisible(),
    listPublicChannels(),
  ]);
  const [latest, postCount, repos] = await Promise.all([
    listLatestPosts(railPostCount),
    countPublishedPosts(),
    listShowcaseRepos(railRepoCount),
  ]);
  const band = await listBandFeed({ limit: bandCount });

  return (
    <div className="mx-auto w-full max-w-[var(--site-max-w)]">
      <SiteSprite />
      <HeroConsole postCount={postCount} heroMd={heroMd || undefined} />

      <div className="mt-7 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* 左主轴:电报流 LIVE 带(原型 tg-band 即整个左栏) */}
        <TelegramBand
          initialItems={band.items}
          channels={channels.length}
          today={today}
          count={bandCount}
          initialNow={Date.now()}
        />

        {/* 右栏:开源项目(M11 白名单 rail)+ 博主文章(紧凑 rail 卡)+ GEO */}
        <aside className="flex min-w-0 flex-col gap-4">
          {repos.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-sm">
              <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-4 py-2.5 text-[13.5px] font-bold">
                <svg className="ic text-text-2" aria-hidden="true">
                  <use href="#i-github" />
                </svg>
                开源项目
                <span className="ml-auto font-mono text-[11px] font-normal tracking-wider text-text-3">
                  [REPOS]
                </span>
              </div>
              {repos.map((repo) => (
                <Link
                  key={repo.id}
                  href={projectPath(repo.slug)}
                  className="block border-b border-line/55 px-4 py-2.5 last:border-b-0 hover:bg-panel-2"
                >
                  <span className="flex items-center gap-2">
                    <svg className="ic ic-sm flex-none text-text-3" aria-hidden="true">
                      <use href="#i-code" />
                    </svg>
                    <span className="truncate font-mono text-[13px] font-semibold text-text-1">
                      {repo.fullName}
                    </span>
                    <span className="ml-auto inline-flex flex-none items-center gap-1 font-mono text-[11.5px] text-text-3">
                      <svg className="ic ic-sm" aria-hidden="true">
                        <use href="#i-star" />
                      </svg>
                      {formatStars(repo.stars)}
                    </span>
                  </span>
                  {repo.description && (
                    <span className="mt-1 block truncate text-[12px] leading-normal text-text-3">
                      {repo.description}
                    </span>
                  )}
                  <span className="mt-1 flex items-center gap-2.5 font-mono text-[11.5px] text-text-3">
                    {repo.language && (
                      <span className="rounded border border-blue/25 bg-blue/10 px-1.5 text-blue">
                        {repo.language}
                      </span>
                    )}
                    <span className="ml-auto">
                      {repo._count.posts > 0 ? `配套文章 ×${repo._count.posts}` : "查看详情 →"}
                    </span>
                  </span>
                </Link>
              ))}
              <div className="border-t border-line bg-panel-2 px-4 py-2 text-center">
                <Link href="/projects/" className="text-[13px] text-text-2 hover:text-accent-hover">
                  全部项目 →
                </Link>
              </div>
            </div>
          )}
          <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-sm">
            <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-4 py-2.5 text-[13.5px] font-bold">
              <svg className="ic text-text-2" aria-hidden="true">
                <use href="#i-read" />
              </svg>
              博主文章
              <span className="ml-auto font-mono text-[11px] font-normal tracking-wider text-text-3">
                [BLOG]
              </span>
            </div>
            {latest.map((post) => (
              <Link
                key={post.id}
                href={postPath(post.id, post.slug)}
                className="block border-b border-line/55 px-4 py-2.5 last:border-b-0 hover:bg-panel-2"
              >
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
              </Link>
            ))}
            <div className="border-t border-line bg-panel-2 px-4 py-2 text-center">
              <Link href="/articles/" className="text-[13px] text-text-2 hover:text-accent-hover">
                全部文章 →
              </Link>
            </div>
          </div>
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
