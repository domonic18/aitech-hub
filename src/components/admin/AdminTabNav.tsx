"use client";

/**
 * admin 页内页签导航(侧栏精简批①②:同域低频页合并的壳层件,系统设置/采集/
 * 发现中心/AI 用量四壳共用)。URL 子段驱动(/admin/settings/email/ 等真实路由,非 query),
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
  // 壳根页签(如设置「常规」/admin/settings/)只精确点亮:否则它会前缀命中
  // 其余所有子页,出现两个页签同时高亮。根 = 所有页签 base 的公共前缀。
  const bases = items.map((t) => t.href.replace(/\/+$/, ""));
  const commonBase = bases.reduce((acc, b) => {
    let i = 0;
    while (i < acc.length && i < b.length && acc[i] === b[i]) i += 1;
    return acc.slice(0, i);
  });
  return (
    <div className="flex flex-wrap overflow-hidden rounded-sm border border-line">
      {items.map((t, idx) => {
        // 前缀匹配去尾斜杠归一(数据壳:洞察页签需点亮 /admin/insight/clusters/… 详情页)
        const base = bases[idx];
        const isShellRoot = base === commonBase;
        const active = isShellRoot
          ? pathname === t.href || pathname === base
          : pathname === t.href || pathname === base || pathname.startsWith(`${base}/`);
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
