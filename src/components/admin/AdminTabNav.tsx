"use client";

/**
 * admin 页内页签导航(侧栏精简批①:同域低频页合并的壳层件,采集/系统设置
 * 两壳共用)。URL 子段驱动(/admin/settings/email/ 等真实路由,非 query),
 * 可直达可收藏;守卫与取数仍在各子页。视觉随评论/反馈页分段胶囊
 * (bg-accent-dim 激活);首签=壳根路径全等点亮,其余按前缀点亮。
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AdminTabNav({
  items,
}: {
  items: ReadonlyArray<{ label: string; href: string }>;
}): React.ReactElement {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap overflow-hidden rounded-sm border border-line">
      {items.map((t, i) => {
        const active =
          i === 0 ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`border-r border-line px-4 py-2 text-[13px] last:border-r-0 ${
              active
                ? "bg-accent-dim font-semibold text-accent"
                : "bg-panel text-text-2 hover:bg-panel-2"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
