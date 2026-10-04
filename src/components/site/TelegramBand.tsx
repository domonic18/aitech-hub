"use client";

/**
 * 首页电报流 LIVE 带(M7 批⑤ 文字条目;M8 批④ 加视频行;批⑧ 视频保底槽位;
 * M10 批② 条数后台可配 + 下滚加载更多):头部 live-chip + 标题 + 巡检统计 + more;
 * 行四列网格 tm/sr/ti/ag(74/108/1fr/auto,窄屏降级按原型 64/92/1fr 隐 ag);
 * SSR 初值 + 60s 轮询(band=1 第一页与 SSR 同源——新条目按 id 去重前插,保留
 * 用户已展开的尾部)+ 底部哨兵 IntersectionObserver 自动加载下一页(offset 分页,
 * 返回条数 < count 判定到底)。视频行:来源位显示「平台 · 博主」,标题前小封面
 * (play 钮 + 底部时长角标,no-referrer 防盗链,失败降级 ▶ 占位块);M9 已解读行
 * 显 AI 徽章 + 概括主题。行点击直达外链。
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  formatDuration,
  hhmm,
  isNew,
  timeAgo,
  videoSourceName,
  type PublicTelegramItem,
} from "@/lib/telegram/feed-view";

const POLL_MS = 60_000;

/** 带内小封面:play 蒙层 + 底部时长横条(原型 .thumb .play/.dur 口径);
 * 失败/无封面降级为 ▶ 占位块(占位即播放语义,不叠蒙层)。 */
function BandCover({ src, duration }: { src: string | null; duration: string | null }) {
  const [failed, setFailed] = useState(false);
  if (src === null || failed) {
    return (
      <span className="inline-flex h-8 w-6 flex-none items-center justify-center rounded-xs bg-panel-2 text-[9px] text-text-3">
        ▶
      </span>
    );
  }
  return (
    <span className="relative inline-flex h-8 w-6 flex-none overflow-hidden rounded-xs bg-panel-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- 平台图床外链,不走 next/image 优化域 */}
      <img
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
      <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
        <svg className="ic ic-sm" aria-hidden="true">
          <use href="#i-caret-right-fill" />
        </svg>
      </span>
      {duration && (
        <span className="absolute inset-x-0 bottom-0 bg-black/70 text-center font-mono text-[8px] leading-3 text-white">
          {duration}
        </span>
      )}
    </span>
  );
}

export default function TelegramBand({
  initialItems,
  channels,
  today,
  count,
}: {
  initialItems: PublicTelegramItem[];
  channels: number;
  today: number;
  /** 后台配置的每页条数(site_config band.item_count,SSR 与轮询/翻页同源) */
  count: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // 60s 轮询:只取第一页(与 SSR 同源),新条目按 id 去重前插,不动已展开的尾部
  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/telegram/public?band=1&limit=${count}`, {
          cache: "no-store",
        });
        const body = (await res.json()) as { code: number; data?: { items: PublicTelegramItem[] } };
        if (alive && body.code === 0 && body.data) {
          const fresh = body.data.items;
          setItems((prev) => {
            const seen = new Set(prev.map((i) => i.id));
            const added = fresh.filter((i) => !seen.has(i.id));
            return added.length > 0 ? [...added, ...prev] : prev;
          });
        }
      } catch {
        /* 轮询失败静默保留旧值 */
      }
      if (alive) setNow(Date.now());
    };
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [count]);

  // 下滚加载更多:底部哨兵进入视口(预载 200px)取下一页;返回不足一页判定到底
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || exhausted) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- items.length 变化后以最新闭包重挂哨兵
  }, [exhausted, items.length, count, loading]);

  const loadMore = async (): Promise<void> => {
    if (loading || exhausted) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/telegram/public?band=1&offset=${items.length}&limit=${count}`, {
        cache: "no-store",
      });
      const body = (await res.json()) as { code: number; data?: { items: PublicTelegramItem[] } };
      if (body.code === 0 && body.data) {
        const page = body.data.items;
        setItems((prev) => {
          const seen = new Set(prev.map((i) => i.id));
          const added = page.filter((i) => !seen.has(i.id));
          return added.length > 0 ? [...prev, ...added] : prev;
        });
        if (page.length < count) setExhausted(true);
      } else {
        setExhausted(true);
      }
    } catch {
      /* 拉取失败静默:哨兵再次进入视口时重试 */
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-panel-2 px-5 py-3.5">
        <span className="inline-flex items-center gap-2 rounded-full border border-green/35 bg-green/10 px-3 py-0.5 font-mono text-xs text-green-hi">
          <span className="live-dot" aria-hidden="true" />
          LIVE
        </span>
        <span className="flex items-center gap-1.5 text-[15px] font-bold">
          <svg className="ic text-text-2" aria-hidden="true">
            <use href="#i-thunderbolt" />
          </svg>
          电报流
        </span>
        <span className="font-mono text-xs text-text-3">
          {channels} 个渠道巡检中 · 文字+视频 · 今日已入库 {today} 条
        </span>
        <Link
          href="/telegram/"
          className="ml-auto whitespace-nowrap text-[13px] text-text-2 hover:text-accent-hover"
        >
          进入电报流 →
        </Link>
      </div>
      {items.map((t) => {
        const fresh = isNew(t.publishedAt, now);
        const video = t.mediaType === "video" ? t.video : undefined;
        const duration = video ? formatDuration(video.durationSeconds) : null;
        return (
          <a
            key={t.id}
            href={t.url}
            target="_blank"
            rel="noopener nofollow"
            className="grid grid-cols-[64px_92px_1fr] items-center gap-3 border-b border-line/55 px-5 py-2.5 last:border-b-0 hover:bg-panel-2 sm:grid-cols-[74px_108px_1fr_auto]"
          >
            <span
              className={`flex-none font-mono text-xs ${fresh ? "text-green-hi" : "text-text-3"}`}
            >
              {hhmm(t.publishedAt)}
            </span>
            <span className="flex-none truncate rounded-sm bg-panel-2 px-1.5 py-px text-center text-[11px] text-text-2">
              {video ? videoSourceName(video) : t.sourceName}
            </span>
            <span className="flex min-w-0 items-center gap-2">
              {video && <BandCover src={video.coverUrl} duration={duration} />}
              {video?.ai ? (
                // AI 徽章 + LLM 概括主题(无主题回退摘要;单行 truncate,band 不放 details)
                <>
                  <span className="flex-none rounded-sm bg-accent-dim px-1 py-px font-mono text-[9px] text-accent">
                    AI
                  </span>
                  <span className="min-w-0 truncate text-[13px] leading-normal text-text-1">
                    {video.ai.topic || video.ai.summary}
                  </span>
                </>
              ) : (
                <span className="min-w-0 truncate text-[13px] leading-normal text-text-1">
                  {t.title}
                </span>
              )}
              <svg className="ic ic-sm flex-none text-text-3" aria-hidden="true">
                <use href="#i-export" />
              </svg>
            </span>
            <span
              className={`hidden flex-none justify-self-end font-mono text-[11px] sm:block ${
                fresh ? "text-green-hi" : "text-text-3"
              }`}
            >
              {fresh ? "NEW · " : ""}
              {timeAgo(t.publishedAt, now)}
            </span>
          </a>
        );
      })}
      {items.length === 0 && (
        <div className="px-5 py-8 text-center text-xs text-text-3">
          电报流预热中,首批内容采集入库后在此滚动
        </div>
      )}
      {/* 加载更多哨兵:进入视口自动取下一页 */}
      <div ref={sentinelRef} className="px-5 py-2.5 text-center font-mono text-[11px] text-text-3">
        {exhausted
          ? items.length > 0
            ? "— 已加载全部 —"
            : ""
          : loading
            ? "加载中…"
            : "↓ 继续滚动加载更多"}
      </div>
      <div className="border-t border-line bg-panel-2 px-5 py-2.5 text-center">
        <Link
          href="/telegram/"
          className="font-mono text-[12.5px] text-text-2 hover:text-accent-hover"
        >
          tail -f /telegram — 查看完整电报流(60s 自动刷新)→
        </Link>
      </div>
    </div>
  );
}
