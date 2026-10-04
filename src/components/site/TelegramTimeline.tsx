"use client";

/**
 * 电报流时间轴(M7 批⑤,原型 site-telegram 一期文字形态):
 * 日分组卡片 + 60s 轮询增量;新讯不打断浏览位置——浮条提示、点击载入。
 */
import { useEffect, useState } from "react";

import {
  groupByDay,
  hhmm,
  hostOf,
  isNew,
  timeAgo,
  type PublicTelegramItem,
} from "@/lib/telegram/feed-view";

const POLL_MS = 60_000;

export default function TelegramTimeline({
  initialItems,
  sourceId,
}: {
  initialItems: PublicTelegramItem[];
  sourceId?: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [pending, setPending] = useState<PublicTelegramItem[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      const after = items[0]?.publishedAt;
      const sp = new URLSearchParams({ limit: "50" });
      if (after) sp.set("after", after);
      if (sourceId !== undefined) sp.set("source", String(sourceId));
      try {
        const res = await fetch(`/api/telegram/public?${sp.toString()}`, { cache: "no-store" });
        const body = (await res.json()) as {
          code: number;
          data?: { items: PublicTelegramItem[]; today: number };
        };
        if (alive && body.code === 0 && body.data) {
          if (body.data.items.length > 0) setPending((p) => [...body.data!.items, ...p]);
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
    // items 只取首元素作增量锚,不随轮询重建定时器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId]);

  const loadPending = (): void => {
    setItems((prev) => {
      const seen = new Set(prev.map((i) => i.id));
      return [...pending.filter((i) => !seen.has(i.id)), ...prev];
    });
    setPending([]);
  };

  return (
    <div>
      {pending.length > 0 && (
        <button
          type="button"
          onClick={loadPending}
          className="mb-3 w-full cursor-pointer rounded-md border border-accent/40 bg-accent-dim px-4 py-2 text-center text-xs text-accent hover:bg-accent/20"
        >
          ↓ {pending.length} 条新电报 · 点击载入,不打断当前浏览位置(轮询 60s)
        </button>
      )}
      {groupByDay(items).map((group) => (
        <section key={group.label} className="mb-5">
          <div className="mb-2.5 flex items-center gap-3">
            <span className="font-mono text-xs font-semibold text-text-2">{group.label}</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="flex flex-col gap-3">
            {group.items.map((t) => (
              <article
                key={t.id}
                className="rounded-lg border border-line bg-panel p-4 shadow-sm hover:border-line-hover"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-sm bg-panel-2 px-1.5 py-px font-mono text-[11px] text-text-2">
                    {t.sourceName}
                  </span>
                  <span className="font-mono text-[11px] text-text-3">
                    {hhmm(t.publishedAt)} · {timeAgo(t.publishedAt, now)}
                  </span>
                  {isNew(t.publishedAt, now) && (
                    <span className="rounded-sm bg-green/10 px-1.5 py-px font-mono text-[10px] text-green-hi">
                      NEW
                    </span>
                  )}
                </div>
                <h3 className="mt-2 text-[15px] font-semibold leading-relaxed">
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noopener nofollow"
                    className="text-text-1 hover:text-accent-hover"
                  >
                    {t.title}
                    <svg className="ic ic-sm ml-1 inline text-text-3" aria-hidden="true">
                      <use href="#i-export" />
                    </svg>
                  </a>
                </h3>
                {t.summary && (
                  <p className="mt-1.5 text-[13px] leading-relaxed text-text-2">{t.summary}</p>
                )}
                <div className="mt-2 flex items-center gap-3 font-mono text-[11px] text-text-3">
                  {hostOf(t.url) && <span>{hostOf(t.url)}</span>}
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noopener nofollow"
                    className="text-text-2 hover:text-accent-hover"
                  >
                    原文 →
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
      {items.length === 0 && (
        <div className="rounded-lg border border-line bg-panel px-4 py-12 text-center text-xs text-text-3">
          暂无条目;采集首轮入库后这里开始滚动
        </div>
      )}
    </div>
  );
}
