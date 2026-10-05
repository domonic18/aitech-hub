"use client";

/**
 * 电报流时间轴(M7 批⑤ 文字形态;M8 批④ 混合流加视频卡;M10 批③ 视频卡原型重排;
 * M12 批③ 文字卡加轻解读块——中心思想 + #关键词 chips):
 * 日分组卡片 + 60s 轮询增量;新讯不打断浏览位置——浮条提示、点击载入。
 * 视频项独立卡形(原型 site-telegram .tg-item.video):竖版大封面
 * 88×157(≤sm 72×128,防盗链 no-referrer,失败降级占位)+ 播放浮层 +
 * 平台角标左上/时长左下 + 标题进卡 + AI 摘要 line-clamp-3 +
 * 互动 播/赞/评(空值整项隐藏)+ 原视频外链;文字卡同构展示 AI 轻解读。
 */
import { useEffect, useState } from "react";

import {
  compactCount,
  formatDuration,
  groupByDay,
  hhmm,
  hostOf,
  isNew,
  platformLabel,
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

/** 视频项独立卡(M10 批③,原型 .tg-item.video):封面列 + 信息列,标题进卡 */
function VideoArticle({ t, now }: { t: PublicTelegramItem; now: number }) {
  const v = t.video!;
  const duration = formatDuration(v.durationSeconds);
  const ai = v.ai;
  // 互动三元组(play 口径后采集可空;空值整项隐藏,同原型显隐跟数据走)
  const engagement = [
    { icon: "i-caret-right-fill", label: "播放", value: compactCount(v.engagement.play) },
    { icon: "i-like", label: "点赞", value: compactCount(v.engagement.like) },
    { icon: "i-comment", label: "评论", value: compactCount(v.engagement.comment) },
  ].filter((e) => e.value !== null);
  return (
    <article className="grid grid-cols-[72px_1fr] gap-4 rounded-lg border border-line bg-panel p-4 shadow-sm hover:border-line-hover">
      <a
        href={t.url}
        target="_blank"
        rel="noopener nofollow"
        className="relative h-[128px] w-[72px] overflow-hidden rounded-sm bg-panel-2 sm:h-[157px] sm:w-[88px]"
        aria-label={`打开原视频:${t.title}`}
      >
        <VideoCover src={v.coverUrl} alt={t.title} />
        <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white">
          <svg className="ic ic-lg" aria-hidden="true">
            <use href="#i-caret-right-fill" />
          </svg>
        </span>
        <span className="absolute left-1 top-1 rounded-xs bg-black/75 px-1 font-mono text-[9.5px] leading-4 text-white">
          {platformLabel(v.platform)}
        </span>
        {duration && (
          <span className="absolute bottom-1 left-1 rounded-xs bg-black/75 px-1 font-mono text-[10px] leading-4 text-white">
            {duration}
          </span>
        )}
      </a>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-sm bg-accent-dim px-1.5 py-px font-mono text-[11px] text-accent">
            {videoSourceName(v)}
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
        <h3 className="text-[15px] font-semibold leading-relaxed">
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
        {ai ? (
          // AI 解读替代原始 summary 段(原型 v.ai 口径;line-clamp-3 防长解读撑破卡)
          <p className="line-clamp-3 text-[13px] leading-relaxed text-text-2">
            <span className="mr-1.5 inline-block rounded-sm bg-accent-dim px-1.5 py-px align-middle font-mono text-[10px] text-accent">
              AI 解读
            </span>
            {ai.summary}
          </p>
        ) : (
          t.summary && (
            <p className="line-clamp-3 text-[13px] leading-relaxed text-text-2">{t.summary}</p>
          )
        )}
        {ai && ai.points.length > 0 && (
          <details className="mt-0.5">
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
        <div className="mt-auto flex flex-wrap items-center gap-3 pt-1 font-mono text-[11px] text-text-3">
          {engagement.map((e) => (
            <span key={e.label} className="flex items-center gap-1" title={e.label}>
              <svg className="ic ic-sm" aria-hidden="true">
                <use href={`#${e.icon}`} />
              </svg>
              {e.value}
            </span>
          ))}
          <a
            href={t.url}
            target="_blank"
            rel="noopener nofollow"
            className="text-text-2 hover:text-accent-hover"
          >
            原视频 ↗
          </a>
          {ai && <span>AI 生成 · 摘要与要点,内容版权归原作者</span>}
        </div>
      </div>
    </article>
  );
}

export default function TelegramTimeline({
  initialItems,
  sourceId,
  media = "all",
  initialNow,
}: {
  initialItems: PublicTelegramItem[];
  sourceId?: number;
  media?: FeedMediaFilter;
  /**
   * SSR 水合基准时钟(服务端 Date.now()):hhmm/timeAgo/NEW/日分组标签以此渲染,
   * 水合后由 60s 轮询刷新。若客户端自取 Date.now(),服务渲染与水合有时差,
   * 相对时间文本不一致 → React #418 水合整树回退,连带把 html[data-theme]
   * 重灌回 light(2026-10-04 修复,与首页带同款)。
   */
  initialNow: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [pending, setPending] = useState<PublicTelegramItem[]>([]);
  const [now, setNow] = useState(initialNow);

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
      {groupByDay(items, now).map((group) => (
        <section key={group.label} className="mb-5">
          <div className="mb-2.5 flex items-center gap-3">
            <span className="font-mono text-xs font-semibold text-text-2">{group.label}</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="flex flex-col gap-3">
            {group.items.map((t) =>
              t.mediaType === "video" && t.video ? (
                <VideoArticle key={t.id} t={t} now={now} />
              ) : (
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
                  {/* 轻解读替代原始 summary(M12 批③;对齐视频卡 v.ai 口径) */}
                  {t.ai ? (
                    <>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-text-2">
                        <span className="mr-1.5 inline-block rounded-sm bg-accent-dim px-1.5 py-px align-middle font-mono text-[10px] text-accent">
                          AI 解读
                        </span>
                        {t.ai.summary}
                      </p>
                      {t.ai.points.length > 0 && (
                        <p className="mt-1.5 flex flex-wrap gap-1.5">
                          {t.ai.points.map((k) => (
                            <span
                              key={k}
                              className="rounded-sm bg-panel-2 px-1.5 py-px font-mono text-[11px] text-text-2"
                            >
                              #{k}
                            </span>
                          ))}
                        </p>
                      )}
                    </>
                  ) : (
                    t.summary && (
                      <p className="mt-1.5 text-[13px] leading-relaxed text-text-2">{t.summary}</p>
                    )
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[11px] text-text-3">
                    {hostOf(t.url) && <span>{hostOf(t.url)}</span>}
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noopener nofollow"
                      className="text-text-2 hover:text-accent-hover"
                    >
                      原文 →
                    </a>
                    {t.ai && <span>AI 生成 · 中心思想与关键词,内容版权归原作者</span>}
                  </div>
                </article>
              ),
            )}
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
