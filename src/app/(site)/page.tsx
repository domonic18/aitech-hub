import Link from "next/link";

import { countPublishedPosts, listLatestPosts } from "@/lib/content/posts";
import { resolveHomeSearchTerms } from "@/lib/config/home-search-terms";
import { getSiteSettings } from "@/lib/config/site-config";
import { formatStars, listShowcaseRepos } from "@/lib/github/public";
import { projectPath } from "@/lib/github/project-path";
import { countTodayVisible, listBandFeed, listPublicChannels } from "@/lib/telegram/public-feed";

import HeroConsole from "@/components/site/HeroConsole";
import HeroBrandLine from "@/components/site/HeroBrandLine";
import PostRail from "@/components/site/PostRail";
import SiteSprite from "@/components/site/SiteSprite";
import TelegramBand from "@/components/site/TelegramBand";
import TrackedLink from "@/components/site/TrackedLink";

/**
 * 首页 Hub(原型 site-home v0.5.0 双栏仪表盘;arch/07-frontend §1:ISR 600s):
 * 终端 hero + hub-grid(左主轴=电报流 LIVE 带;右栏=开源项目卡 + 博主文章/推荐视频
 * 紧凑卡 + GEO)。电报带/项目/文章条数与 hub 主文案后台可配(M10/M12,site_config,保存后
 * on-demand revalidate 本页);客户端 60s 轮询(M7 批⑤;下滚加载更多 M10 已于
 * 2026-10-05 移除,带内固定一页)。
 * GitHub 项目卡 M11:白名单空(全部下架)整卡不渲染,「三区可独立降级」。
 * 2026-10-05 性能批次:配置走 getSiteSettings 单查询;取数三段串行改两段
 * (band 只依赖配置段,与 rails 并行);hero markdown 服务端渲染下传。
 * 2026-10-20 验收反馈问题二:文章 rail 按分类原创标记分流——原创分类
 * (blog/report)进「博主文章」,非原创(推荐视频等)进「推荐视频」rail
 * (空则整卡不渲染,同开源项目卡降级口径)。
 */
export const revalidate = 600;

export default async function HomePage(): Promise<React.ReactElement> {
  // 配置段先行(rail/band 条数是后续取数的入参):getSiteSettings 单查询读全键,
  // 与巡检统计/渠道清单并行
  const [cfg, today, channels] = await Promise.all([
    getSiteSettings(),
    countTodayVisible(),
    listPublicChannels(),
  ]);
  // rails 与电报带并行(band 仅依赖 cfg.bandItemCount);文章 rail 按原创标记分流;
  // 搜索建议词 chips 同段装配(固定词 + 洞察关键词云自动补齐,M70)
  const [latest, videos, postCount, repos, band, suggestions] = await Promise.all([
    listLatestPosts(cfg.postCount, { original: true }),
    listLatestPosts(cfg.postCount, { original: false }),
    countPublishedPosts(),
    listShowcaseRepos(cfg.repoCount),
    listBandFeed({ limit: cfg.bandItemCount }),
    resolveHomeSearchTerms(cfg.homeSearchTerms),
  ]);

  return (
    <div className="mx-auto w-full max-w-[var(--site-max-w)]">
      <SiteSprite />
      <HeroConsole postCount={postCount} suggestions={suggestions}>
        <HeroBrandLine heroMd={cfg.heroMd || undefined} />
      </HeroConsole>

      <div className="mt-7 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* 左主轴:电报流 LIVE 带(原型 tg-band 即整个左栏) */}
        <TelegramBand
          initialItems={band.items}
          channels={channels.length}
          today={today}
          count={cfg.bandItemCount}
          initialNow={Date.now()}
        />

        {/* 右栏:开源项目(M11 白名单 rail)+ 博主文章/推荐视频(原创标记分流)+ GEO */}
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
                <TrackedLink
                  key={repo.id}
                  href={projectPath(repo.slug)}
                  surface="home"
                  kind="project"
                  entryKey={repo.slug}
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
                </TrackedLink>
              ))}
              <div className="border-t border-line bg-panel-2 px-4 py-2 text-center">
                <Link href="/projects/" className="text-[13px] text-text-2 hover:text-accent-hover">
                  全部项目 →
                </Link>
              </div>
            </div>
          )}
          <PostRail
            icon="#i-read"
            title="博主文章"
            tag="BLOG"
            posts={latest}
            footerLink={{ href: "/articles/", label: "全部文章 →" }}
            track={{ surface: "home", kind: "post" }}
          />
          {/* 推荐视频 rail:非原创分类(推荐视频等);空则整卡不渲染。
              不设底栏「更多」链接——非原创集合≠单一分类,硬编码 slug 会随分类
              漂移,后续确有聚合页诉求再立 */}
          {videos.length > 0 && (
            <PostRail
              icon="#i-caret-right-fill"
              title="推荐视频"
              tag="VIDEO"
              posts={videos}
              track={{ surface: "home", kind: "post" }}
            />
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
                {["/llms.txt", "/feed.xml"].map((href) => (
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
