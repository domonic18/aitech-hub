"use client";

/**
 * 首页电报流 LIVE 带(M7 批⑤ 文字条目;M8 批④ 加视频行):
 * 头部 live-chip + 标题 + 巡检统计 + more;行四列网格 tm/sr/ti/ag(74/108/1fr/auto,
 * 窄屏降级按原型 64/92/1fr 隐 ag);SSR 初值 + 60s 轮询(visible only);行点击直达外链。
 * 视频行:来源位显示「平台 · 博主」,标题前小封面(no-referrer 防盗链,失败隐图留 duration 角标语义)。
 */
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  formatDuration,
  hhmm,
  isNew,
  timeAgo,
  videoSourceName,
  type PublicTelegramItem,
} from "@/lib/telegram/feed-view";

const POLL_MS = 60_000;
const BAND_LIMIT = 8;

/** 带内小封面:失败/无封面降级为 ▶ 占位块(不重试) */
function BandCover({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (src === null || failed) {
    return (
      <span className="inline-flex h-8 w-6 flex-none items-center justify-center rounded-xs bg-panel-2 text-[9px] text-text-3">
        ▶
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 平台图床外链,不走 next/image 优化域
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="inline-block h-8 w-6 flex-none rounded-xs object-cover"
    />
  );
}

export default function TelegramBand({
  initialItems,
  channels,
  today,
}: {
  initialItems: PublicTelegramItem[];
  channels: number;
  today: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/telegram/public?limit=${BAND_LIMIT}`, { cache: "no-store" });
        const body = (await res.json()) as { code: number; data?: { items: PublicTelegramItem[] } };
        if (alive && body.code === 0 && body.data) setItems(body.data.items);
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
  }, []);

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
              {video && <BandCover src={video.coverUrl} />}
              <span className="min-w-0 truncate text-[13px] leading-normal text-text-1">
                {t.title}
                <svg className="ic ic-sm ml-1 inline text-text-3" aria-hidden="true">
                  <use href="#i-export" />
                </svg>
              </span>
            </span>
            <span
              className={`hidden flex-none justify-self-end font-mono text-[11px] sm:block ${
                fresh ? "text-green-hi" : "text-text-3"
              }`}
            >
              {duration ? `${duration} · ` : ""}
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
