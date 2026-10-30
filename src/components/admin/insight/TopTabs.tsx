"use client";

/**
 * 洞察中心顶部 chips(F11/F10 板 stBar:分析总览 | 发现;M58 批② 增 事件),
 * 真实路由切换。簇详情页(/admin/insight/clusters/…)板面无 stBar(F25/F26),
 * 返回 null 隐藏。
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { label: "分析总览", href: "/admin/insight/", base: "/admin/insight" },
  { label: "发现", href: "/admin/insight/discovery/", base: "/admin/insight/discovery" },
  { label: "事件", href: "/admin/insight/events/", base: "/admin/insight/events" },
] as const;

export default function InsightTopTabs(): React.ReactElement | null {
  const pathname = usePathname();
  // 簇详情是独立板面(无 stBar):整条隐藏(总览 base 是其余页面的前缀,
  // 不显式排除会被误点亮)
  if (pathname.startsWith("/admin/insight/clusters/")) return null;
  // 其余页面取最长 base 命中(如 /admin/insight/events 同时命中总览 base)
  const active = ITEMS.filter(
    (t) => pathname === t.href || pathname === t.base || pathname.startsWith(`${t.base}/`),
  ).sort((a, b) => b.base.length - a.base.length)[0];
  if (active === undefined) return null;
  return (
    <div className="flex items-center gap-1.5">
      {ITEMS.map((t) => {
        const on = t.label === active.label;
        return (
          <Link
            key={t.label}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`rounded-sm px-3 py-1.5 text-[12.5px] ${
              on
                ? "bg-accent-dim font-semibold text-accent"
                : "bg-panel-2 text-text-2 hover:text-text-1"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
