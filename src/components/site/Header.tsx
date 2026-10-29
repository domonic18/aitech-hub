import Link from "next/link";

import ThemeToggle from "@/components/ThemeToggle";
import TopicNavMenu from "@/components/site/TopicNavMenu";
import { SITE_TOPICS } from "@/lib/content/topics";

import { getSiteTitle } from "@/lib/config/site-config";

import HeaderSession from "./HeaderSession";
import SiteSprite from "./SiteSprite";

type NavItem = {
  href: string;
  label: string;
  /** lg 悬停二级菜单(专题等聚合入口用);缺省为普通直链 */
  children?: ReadonlyArray<{ href: string; label: string }>;
};

const NAV: ReadonlyArray<NavItem> = [
  { href: "/", label: "首页" },
  { href: "/telegram/", label: "电报流" },
  { href: "/articles/", label: "文章" },
  { href: "/projects/", label: "项目" },
  { href: "/pins/", label: "贴图" },
  // 专题聚合(A1 2026-10-29):价格速查等参考工具页归入专题;lg 悬停二级
  // 菜单直达各专题(注册表与 /topics/ 同源防漂移),点击「专题」本体进索引页
  {
    href: "/topics/",
    label: "专题",
    children: SITE_TOPICS.map((t) => ({ href: t.href, label: t.label })),
  },
];

/**
 * 站点顶栏(DESIGN-SPEC §5):logo 17 monogram 芯片 + 站名(site_config
 * site.title,缺省「一起AI」,规格见 common.css §Logo)+ 域名 tld;nav 电报流随 M7(批⑤)挂入;
 * 专题下拉随 M56 验收挂入(A1 聚合,二级菜单与 /topics/ 同源);
 * 搜索入口为图标 → /search;主题胶囊全站可用;头像菜单随三期用户体系,一期不渲染。
 * 窄屏降级(DESIGN-SPEC §6):tld 隐藏;横滚兜底只包 logo+导航(M22 验收修复:
 * overflow-x 容器会裁剪头像下拉,操作区必须留在横滚容器外);操作区顺序
 * 搜索 → 主题 → 头像(头像最右,2026-10-09 验收反馈)。
 * 归档/关于不进主菜单(2026-10-05 反馈;路由保留,入口在 Footer/sitemap)。
 */
export default async function Header(): Promise<React.ReactElement> {
  const siteTitle = await getSiteTitle();

  return (
    <header
      className="sticky top-0 z-40 border-b border-line"
      style={{ background: "var(--header-bg)", backdropFilter: "blur(12px)" }}
    >
      <div className="mx-auto flex h-16 w-full max-w-[var(--site-max-w)] flex-nowrap items-center gap-1 px-4 sm:gap-2 sm:px-6">
        <div className="no-scrollbar flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-x-auto sm:gap-2">
          <SiteSprite />
          <Link
            href="/"
            className="mr-3 flex flex-none items-center gap-2.5 text-[17px] font-bold sm:mr-6"
          >
            <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-sm bg-accent font-mono text-[14px] font-bold tracking-[-0.5px] text-white shadow-[0_0_12px_var(--glow)]">
              17
            </span>
            {siteTitle}
            <span className="hidden font-mono text-[13px] font-normal text-text-3 sm:inline">
              17aitech.com
            </span>
          </Link>
          <nav className="flex flex-nowrap items-center gap-1 text-sm">
            {NAV.map((item) =>
              item.children === undefined ? (
                <Link
                  key={item.href}
                  href={item.href}
                  className="whitespace-nowrap rounded-sm px-2 py-1.5 text-text-2 hover:bg-panel-2 hover:text-text-1 sm:px-3"
                >
                  {item.label}
                </Link>
              ) : (
                // 二级下拉(客户端岛屿:fixed 定位逃出横滚裁剪;悬停展开,点击进索引页)
                <TopicNavMenu key={item.href} label={item.label} href={item.href}>
                  {item.children}
                </TopicNavMenu>
              ),
            )}
          </nav>
        </div>
        <Link
          href="/search"
          title="搜索"
          aria-label="搜索"
          className="inline-flex flex-none items-center rounded-sm p-2 text-text-2 hover:bg-panel-2 hover:text-text-1"
        >
          <svg className="ic" aria-hidden="true">
            <use href="#i-search" />
          </svg>
        </Link>
        <ThemeToggle />
        <HeaderSession />
      </div>
    </header>
  );
}
