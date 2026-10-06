"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * 全站 beacon 上报(requirement §3.5):兼容 ISR——缓存页不发服务端计数,
 * 客户端上报天然排除服务端缓存命中;sendBeacon 异步,不阻塞渲染。
 * 站内路由跳转也计 PV(WP 同口径);referrer 仅入口页携带,
 * 站内跳转按 direct 计——与 wp-statistics 的行为一致。
 * /search 页携 q(2026-10-06 搜索词排行):query 变化(如追问 chips 软导航)
 * 也重发,顺带修正换 q 不计 PV 的缺口。useSearchParams 须包 Suspense
 * (site/layout.tsx),否则静态预渲染页 build 报错。
 */
export default function StatsBeacon(): null {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const entryRef = useRef(true);

  useEffect(() => {
    const referrer = entryRef.current ? document.referrer : "";
    entryRef.current = false;
    // trailingSlash 站点 usePathname 无尾斜杠;剥尾斜杠判定,兼容历史带斜杠形态
    const onSearch = pathname.replace(/\/+$/, "") === "/search";
    const q = onSearch ? (searchParams.get("q") ?? "").trim().slice(0, 100) : "";
    const payload = JSON.stringify(
      q !== "" ? { path: pathname, referrer, q } : { path: pathname, referrer },
    );
    try {
      // trailingSlash 站点:直接打带斜杠地址,省一次 308
      navigator.sendBeacon?.("/api/view/", new Blob([payload], { type: "application/json" }));
    } catch {
      // 统计上报失败不影响前台
    }
  }, [pathname, qs, searchParams]);

  return null;
}
