"use client";

/**
 * 电报流时间轴(M7 批⑤ 文字形态;M8 批④ 混合流加视频卡):
 * 日分组卡片 + 60s 轮询增量;新讯不打断浏览位置——浮条提示、点击载入。
 * 视频卡:竖版封面(防盗链 no-referrer,加载失败降级占位)+ 时长角标 +
 * 平台·博主 + 互动数 + 原视频外链;无 AI 解读不显 AI 标注(解读为后置立项)。
 */
import { useEffect, useState } from "react";

import {
  compactCount,
  formatDuration,
  groupByDay,
  hhmm,
  hostOf,
  isNew,
  timeAgo,
  videoSourceName,
  type FeedMediaFilter,
  type PublicTelegramItem,
} from "@/lib/telegram/feed-view";

const POLL_MS = 60_000;

/** 封面缩略(抖音图床带防盗链:no-referrer + 失败换占位块,不重试) */
function VideoCover({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (src === null || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-panel-2 font-mono text-[10px] text-text-3">
        ▶
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 平台图床外链,不走 next/image 优化域
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}

function VideoCard({ t }: { t: PublicTelegramItem }) {
  const v = t.video!;
  const duration = formatDuration(v.durationSeconds);
  const like = compactCount(v.engagement.like);
  const comment = compactCount(v.engagement.comment);
  const ai = v.ai;
  return (
    <div className="mt-2.5 flex gap-3">
      <a
        href={t.url}
        target="_blank"
        rel="noopener nofollow"
        className="relative h-[84px] w-[63px] flex-none overflow-hidden rounded-sm bg-panel-2"
        aria-label={`打开原视频:${t.title}`}
      >
        <VideoCover src={v.coverUrl} alt={t.title} />
        {duration && (
          <span className="absolute bottom-0.5 right-0.5 rounded-xs bg-black/70 px-1 font-mono text-[10px] leading-4 text-white">
            {duration}
          </span>
        )}
      </a>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
          <span className="rounded-sm bg-accent-dim px-1.5 py-px text-accent">
            {videoSourceName(v)}
          </span>
          {like && <span className="text-text-3">赞 {like}</span>}
          {comment && <span className="text-text-3">评 {comment}</span>}
        </div>
        {ai ? (
          // AI 解读替代原始 summary 段(原型 site-telegram v.ai 口径;显隐跟数据走)
          <>
            <p className="mt-1 text-[12.5px] leading-relaxed text-text-2">
              <span className="mr-1.5 inline-block rounded-sm bg-accent-dim px-1.5 py-px align-middle font-mono text-[10px] text-accent">
                AI 解读
              </span>
              {ai.summary}
            </p>
            {ai.points.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer font-mono text-[11px] text-text-3 hover:text-accent-hover">
                  关键要点 ×{ai.points.length}
                </summary>
                <ul className="mt-1 list-disc pl-5 text-[12px] leading-relaxed text-text-2">
                  {ai.points.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </details>
            )}
            <p className="mt-1 font-mono text-[10.5px] text-text-3">
              AI 生成 · 摘要与要点,内容版权归原作者
            </p>
          </>
        ) : (
          t.summary && <p className="mt-1 text-[12.5px] leading-relaxed text-text-2">{t.summary}</p>
        )}
        <a
          href={t.url}
          target="_blank"
          rel="noopener nofollow"
          className="mt-1 inline-block font-mono text-[11px] text-text-2 hover:text-accent-hover"
        >
          原视频 ↗
        </a>
      </div>
    </div>
  );
}

export default function TelegramTimeline({
  initialItems,
  sourceId,
  media = "all",
}: {
  initialItems: PublicTelegramItem[];
  sourceId?: number;
  media?: FeedMediaFilter;
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
      if (media !== "all") sp.set("media", media);
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
  }, [sourceId, media]);

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
                    {t.mediaType === "video" && t.video ? videoSourceName(t.video) : t.sourceName}
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
                {t.mediaType === "video" && t.video ? (
                  <VideoCard t={t} />
                ) : (
                  t.summary && (
                    <p className="mt-1.5 text-[13px] leading-relaxed text-text-2">{t.summary}</p>
                  )
                )}
                {t.mediaType !== "video" && (
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
                )}
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
