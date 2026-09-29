"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * 全站 beacon 上报(requirement §3.5):兼容 ISR——缓存页不发服务端计数,
 * 客户端上报天然排除服务端缓存命中;sendBeacon 异步,不阻塞渲染。
 * 站内路由跳转也计 PV(WP 同口径);referrer 仅入口页携带,
 * 站内跳转按 direct 计——与 wp-statistics 的行为一致。
 */
export default function StatsBeacon(): null {
  const pathname = usePathname();
  const entryRef = useRef(true);

  useEffect(() => {
    const referrer = entryRef.current ? document.referrer : "";
    entryRef.current = false;
    const payload = JSON.stringify({ path: pathname, referrer });
    try {
      // trailingSlash 站点:直接打带斜杠地址,省一次 308
      navigator.sendBeacon?.("/api/view/", new Blob([payload], { type: "application/json" }));
    } catch {
      // 统计上报失败不影响前台
    }
  }, [pathname]);

  return null;
}
