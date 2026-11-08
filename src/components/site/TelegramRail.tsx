import Link from "next/link";

import { timeAgo, feedChipTone, FEED_CHIP_TONE_CLASSES } from "@/lib/telegram/feed-view";
import type { PublicTelegramItem } from "@/lib/telegram/feed-view";

/**
 * 文章页右栏「最近电报」(2026-11-01 阅读页优化):
 * 服务端只读 5 条已可见条目(public-feed 自带 M15 终态 + visible 门禁,已包
 * prerenderSafe),纯展示不轮询 —— 不用 client 的 TelegramBand(带 60s 轮询,
 * 对文章页是多余负担)。外链与 TelegramTimeline 同口径:新窗 + noopener nofollow。
 * 空则整卡不渲染(与首页各 rail 的降级口径一致)。
 */
export default function TelegramRail({
  items,
}: {
  items: PublicTelegramItem[];
}): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-sm">
      <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-4 py-2.5 text-[13.5px] font-bold">
        <svg className="ic text-text-2" aria-hidden="true">
          <use href="#i-thunderbolt" />
        </svg>
        最近电报
        <span className="ml-auto font-mono text-[11px] font-normal tracking-wider text-text-3">
          [TG]
        </span>
      </div>
      {items.map((item) => (
        <a
          key={item.id}
          href={item.url}
          target="_blank"
          rel="noopener nofollow"
          className="block border-b border-line/55 px-4 py-2.5 last:border-b-0 hover:bg-panel-2"
        >
          <span className="line-clamp-2 text-[13px] font-medium leading-normal text-text-1 hover:text-accent-hover">
            {item.title}
          </span>
          <span className="mt-1 flex items-center gap-2 font-mono text-[11.5px] text-text-3">
            <span
              className={`max-w-[9rem] truncate rounded-sm border px-1.5 py-px ${
                FEED_CHIP_TONE_CLASSES[feedChipTone(item.sourceType, item.video?.platform)]
              }`}
            >
              {item.sourceName}
            </span>
            <span className="ml-auto whitespace-nowrap">{timeAgo(item.publishedAt)}</span>
          </span>
        </a>
      ))}
      <div className="border-t border-line bg-panel-2 px-4 py-2 text-center">
        <Link href="/telegram/" className="text-[13px] text-text-2 hover:text-accent-hover">
          进入电报流 →
        </Link>
      </div>
    </div>
  );
}
