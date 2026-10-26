"use client";

import { useEffect } from "react";

/**
 * 搜索命中数上报桥(M34 批①):命中数在服务端 SSR 已算好(searchAll),beacon
 * 却在客户端 StatsBeacon 发——经 window 全局传递,q 变化重挂、卸载清除防陈旧
 * (StatsBeacon 侧校验 meta.q 与本次 q 一致才采信)。不渲染任何内容。
 */
export default function SearchHitMeta({ q, hits }: { q: string; hits: number }): null {
  useEffect(() => {
    (window as { __searchHitMeta?: unknown }).__searchHitMeta = { q, hits };
    return () => {
      delete (window as { __searchHitMeta?: unknown }).__searchHitMeta;
    };
  }, [q, hits]);
  return null;
}
