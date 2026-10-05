"use client";

/**
 * admin 侧栏(DESIGN-SPEC §5 admin 侧栏 v2,220px):分组 + 图标 + 二期/M5 tag。
 * 未交付项一律禁用态展示(降级注记,不静默消失),不挂死链接。
 * M13 移动端:<1024 抽屉化(受控 open,开/关由 AdminShell 持有);
 * ≥1024(lg)固定常驻原样。隐藏走 -translate-x-full 而非 hidden,保留滑动动画。
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { icon: string; label: string; href?: string; tag?: "M5" | "二期" };
type Group = { label: string; items: Item[] };

const GROUPS: ReadonlyArray<Group> = [
  {
    label: "OVERVIEW",
    items: [
      { icon: "i-dashboard", label: "站点统计", href: "/admin" },
      { icon: "i-setting", label: "站点设置", href: "/admin/settings" },
    ],
  },
  {
    label: "内容管理",
    items: [
      { icon: "i-filetext", label: "文章管理", href: "/admin/posts" },
      { icon: "i-picture", label: "媒体库", href: "/admin/media" },
      { icon: "i-send", label: "电报流治理", href: "/admin/telegram" },
    ],
  },
  {
    label: "采集",
    items: [
      { icon: "i-scan", label: "采集总览", href: "/admin/spider" },
      { icon: "i-cloudserver", label: "渠道配置", href: "/admin/channels" },
      { icon: "i-aim", label: "博主管理", href: "/admin/bloggers" },
      { icon: "i-github", label: "GitHub 仓库", href: "/admin/github" },
    ],
  },
  {
    label: "AI 服务",
    items: [
      { icon: "i-robot", label: "模型配置", href: "/admin/models" },
      { icon: "i-piechart", label: "用量统计", tag: "二期" },
      { icon: "i-comment", label: "会话管理", tag: "二期" },
    ],
  },
  { label: "用户", items: [{ icon: "i-user", label: "用户管理", href: "/admin/users" }] },
  { label: "系统", items: [{ icon: "i-key", label: "PAT 令牌", href: "/admin/pats" }] },
];

export default function AdminSidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.ReactElement {
  const pathname = usePathname();

  return (
    <aside
      className={`fixed top-0 left-0 z-20 flex h-screen w-[var(--admin-sidebar-w)] flex-col overflow-y-auto border-r border-line bg-panel transition-transform duration-200 lg:translate-x-0 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="inline-block h-4 w-2 bg-accent" aria-hidden="true" />
        <span className="text-sm font-semibold tracking-wide">一起AI 控制台</span>
        <button
          type="button"
          aria-label="关闭菜单"
          onClick={onClose}
          className="ml-auto cursor-pointer rounded-sm p-1 text-text-2 hover:bg-panel-2 hover:text-text-1 lg:hidden"
        >
          <svg className="ic" aria-hidden="true">
            <use href="#i-close" />
          </svg>
        </button>
      </div>

      <nav className="flex-1 px-2 pb-4">
        {GROUPS.map((group) => (
          <div key={group.label} className="mb-3">
            <div className="px-2 py-1.5 font-mono text-[10px] tracking-[0.08em] text-text-3 uppercase">
              {group.label}
            </div>
            {group.items.map((item) => {
              const active =
                item.href !== undefined &&
                (pathname === item.href || pathname.startsWith(`${item.href}/`));
              if (item.href) {
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] ${
                      active
                        ? "bg-accent-dim font-medium text-accent"
                        : "text-text-2 hover:bg-panel-2 hover:text-text-1"
                    }`}
                  >
                    <svg className="ic" aria-hidden="true">
                      <use href={`#${item.icon}`} />
                    </svg>
                    {item.label}
                  </Link>
                );
              }
              return (
                <span
                  key={item.label}
                  aria-disabled="true"
                  title={`${item.tag} 交付`}
                  className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-text-3"
                >
                  <svg className="ic" aria-hidden="true">
                    <use href={`#${item.icon}`} />
                  </svg>
                  {item.label}
                  <span className="ml-auto rounded-sm bg-panel-2 px-1 py-px font-mono text-[10px] text-text-3">
                    {item.tag}
                  </span>
                </span>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-line px-4 py-3">
        <Link href="/" className="text-xs text-text-2 hover:text-accent">
          ← 返回前台站点
        </Link>
      </div>
    </aside>
  );
}
