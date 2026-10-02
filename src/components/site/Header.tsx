import Link from "next/link";

import ThemeToggle from "@/components/ThemeToggle";

import SiteSprite from "./SiteSprite";

const NAV = [
  { href: "/", label: "首页" },
  { href: "/articles/", label: "文章" },
  { href: "/archive/", label: "归档", smOnly: true },
  { href: "/about/", label: "关于", smOnly: true },
];

/**
 * 站点顶栏(DESIGN-SPEC §5 一期降级形态):logo 17 monogram 芯片(品牌「一起AI」,
 * 2026-10-02 定稿,规格见 common.css §Logo)+ 域名 tld;nav 暂无电报流(二期);
 * 搜索入口为图标 → /search;主题胶囊全站可用;头像菜单随三期用户体系,一期不渲染。
 * 归档/关于暂留 nav,收敛 footer 与电报流 nav 随二期视觉回补同批。
 * 窄屏降级(DESIGN-SPEC §6):tld 隐藏、归档/关于收起(footer 有同款入口),
 * 整行禁止换行;超宽兜底可横滚(no-scrollbar)。
 */
export default function Header(): React.ReactElement {
  return (
    <header
      className="sticky top-0 z-40 border-b border-line"
      style={{ background: "var(--header-bg)", backdropFilter: "blur(12px)" }}
    >
      <div className="no-scrollbar mx-auto flex h-16 w-full max-w-[var(--site-max-w)] flex-nowrap items-center gap-1 overflow-x-auto px-4 sm:gap-2 sm:px-6">
        <SiteSprite />
        <Link
          href="/"
          className="mr-3 flex flex-none items-center gap-2.5 text-[17px] font-bold sm:mr-6"
        >
          <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-sm bg-accent font-mono text-[14px] font-bold tracking-[-0.5px] text-white shadow-[0_0_12px_var(--glow)]">
            17
          </span>
          一起AI
          <span className="hidden font-mono text-[13px] font-normal text-text-3 sm:inline">
            17aitech.com
          </span>
        </Link>
        <nav className="flex flex-1 flex-nowrap items-center gap-1 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap rounded-sm px-2 py-1.5 text-text-2 hover:bg-panel-2 hover:text-text-1 sm:px-3${
                item.smOnly ? " hidden sm:inline-block" : ""
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
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
      </div>
    </header>
  );
}
