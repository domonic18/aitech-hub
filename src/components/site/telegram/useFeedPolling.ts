"use client";

/**
 * 电报流 60s 轮询样板(P2-14c 自 技术债评审 收敛:TelegramBand 与
 * TelegramTimeline 各持一份 alive 卸载守卫 + setInterval + fetch
 * /api/telegram/public + 条目合流 + setNow 时钟刷新):
 * - alive 守卫语义保留:卸载置 false + clearInterval,迟到响应/时钟全丢弃;
 * - 查询串与合流策略由调用侧注入(带=band+limit 截一页;流=after 增量锚+
 *   source/media,锚在调用侧 ref 内自推进);
 * - 回调经 ref 透传:定时器只建一次(筛选/换源经 key 重挂载,props 实际
 *   SSR 级稳定),每次 tick 读最新渲染闭包,不因引用变化重建定时器;
 * - 轮询失败静默保留旧值;成功且 alive 才合流,并在 tick 末刷新 now 时钟。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { PublicTelegramItem } from "@/lib/telegram/feed-view";

/** /api/telegram/public 响应 data(today 恒随 items 返回,见 api route) */
export interface FeedPollPayload {
  items: PublicTelegramItem[];
  today: number;
}

export function useFeedPolling({
  initialItems,
  initialNow,
  intervalMs = 60_000,
  buildQuery,
  merge,
  onData,
}: {
  initialItems: PublicTelegramItem[];
  /** SSR 水合基准时钟(服务端 Date.now(),防水合回退——调用侧 props 注释) */
  initialNow: number;
  /** 轮询间隔(首页带传 BAND_POLL_MS;缺省 60s) */
  intervalMs?: number;
  /** 每次 tick 构造查询串(after 增量锚在调用侧闭包内取) */
  buildQuery: () => string;
  /** 新鲜条目合流(去重/同构重排/截页策略调用侧定) */
  merge: (prev: PublicTelegramItem[], fresh: PublicTelegramItem[]) => PublicTelegramItem[];
  /** items 外字段透出(时间轴 today 计数);code===0 且 data 存在时调用 */
  onData?: (data: FeedPollPayload) => void;
}): {
  items: PublicTelegramItem[];
  now: number;
  /** 追加一页(M69「加载更多」):走与轮询相同的 merge/id 去重路径 */
  append: (fresh: PublicTelegramItem[]) => void;
} {
  const [items, setItems] = useState(initialItems);
  const [now, setNow] = useState(initialNow);
  // 回调 ref 透传:定时器只建一次,tick 恒读最新渲染的闭包
  const cbsRef = useRef({ buildQuery, merge, onData });
  cbsRef.current = { buildQuery, merge, onData };

  const append = useCallback((fresh: PublicTelegramItem[]): void => {
    if (fresh.length === 0) return;
    setItems((prev) => cbsRef.current.merge(prev, fresh));
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      const { buildQuery, merge, onData } = cbsRef.current;
      try {
        const res = await fetch(`/api/telegram/public?${buildQuery()}`, { cache: "no-store" });
        const body = (await res.json()) as { code: number; data?: FeedPollPayload };
        if (alive && body.code === 0 && body.data) {
          if (body.data.items.length > 0) {
            setItems((prev) => merge(prev, body.data!.items));
          }
          onData?.(body.data);
        }
      } catch {
        /* 轮询失败静默保留旧值 */
      }
      if (alive) setNow(Date.now());
    };
    const t = setInterval(() => void tick(), intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intervalMs]);

  return { items, now, append };
}
