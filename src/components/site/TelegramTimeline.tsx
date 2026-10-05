"use client";

/**
 * 电报流时间轴(M7 批⑤ 文字形态;M8 批④ 混合流加视频卡;M12 批③ 文字卡加轻解读;
 * 批⑥ 要点折叠列表 + 关键词蓝系 chips;M15 批③ 新内容交互对齐 ai-invest-assisstant):
 * 日分组卡片 + 60s 轮询增量。新讯**即刷即渲染**(mergeFeedItems 按服务端同构序
 * 重排,不打断浏览位置),未读锚 seenTopId(已见列表首行 id)之上条数即未读
 * ——虚线浮条提示,点击平滑回顶并重置锚(与 ai-invest 电报流同款交互语义)。
 * 视频卡形抽至 TelegramArticle(壳文件守 350 行限);文字卡同构展示 AI 轻解读。
 */
import { useEffect, useRef, useState } from "react";

import VideoArticle from "@/components/site/TelegramArticle";
import {
  countUnseen,
  feedChipTone,
  groupByDay,
  hhmm,
  hostOf,
  isNew,
  mergeFeedItems,
  timeAgo,
  FEED_CHIP_TONE_CLASSES,
  type FeedMediaFilter,
  type PublicTelegramItem,
} from "@/lib/telegram/feed-view";

const POLL_MS = 60_000;

export default function TelegramTimeline({
  initialItems,
  sourceId,
  media = "all",
  initialNow,
  initialToday,
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
  /** SSR 首屏「今日已入库」(countTodayVisible,采集活性口径):列表空但今日有
   * 入库时,空态改述为「AI 解读处理中」——条目在解读终态才上屏(M15 批①) */
  initialToday: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [now, setNow] = useState(initialNow);
  const [today, setToday] = useState(initialToday);
  // 未读锚=用户已见的列表首行 id(ai-invest 同款;id 稳定,不受排序变动影响):
  // SSR 首屏首行视为已见;轮询前插后锚不动 → 其上条数即未读;点击浮条回顶重置;
  // 筛选/换源经 key 重挂载自然归零。「中段插入」(旧发布新解读)在锚下,不计未读。
  const [seenTopId, setSeenTopId] = useState<string | null>(initialItems[0]?.id ?? null);
  // 增量锚=已见最大 aiRanAt(M15 批①,变可见时刻):ref 持有不随轮询重建定时器。
  // ISO 同为 toISOString() 产物(UTC Z 定长),字典序即时间序。
  const afterRef = useRef(
    initialItems.reduce<string | null>(
      (max, t) => (max === null || t.aiRanAt > max ? t.aiRanAt : max),
      null,
    ),
  );

  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      const after = afterRef.current;
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
          if (body.data.items.length > 0) {
            // 即刷即渲染(M15 批③):mergeFeedItems 同构重排;增量锚推进到全表
            // 最大 aiRanAt(updater 内 max 推进幂等,StrictMode 双调无副作用)
            setItems((prev) => {
              const merged = mergeFeedItems(prev, body.data!.items);
              for (const t of merged) {
                if (afterRef.current === null || t.aiRanAt > afterRef.current)
                  afterRef.current = t.aiRanAt;
              }
              return merged;
            });
          }
          setToday(body.data.today);
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
    // 锚在 afterRef 内自推进,不随轮询重建定时器
  }, [sourceId, media]);

  // 浮条点击:重置未读锚到当前首行 + 平滑回顶(ai-invest 同款;即刷即渲染下
  // 内容已在列表,「载入」即回到顶部阅读)
  const backToTop = (): void => {
    setSeenTopId(items[0]?.id ?? null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const unseen = countUnseen(items, seenTopId);

  return (
    <div>
      {unseen > 0 && (
        <button
          type="button"
          onClick={backToTop}
          className="mb-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-accent/45 bg-accent-dim px-4 py-2 text-xs text-accent transition-colors hover:bg-accent/20"
        >
          <span aria-hidden="true">↑</span>
          <b>{unseen} 条新电报</b>
          <span className="font-normal text-accent/70">点击回到顶部载入,不打断当前浏览位置</span>
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
                  className="rounded-lg border border-line bg-panel p-4 shadow-sm transition-colors hover:border-line-hover hover:bg-panel-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-sm border px-1.5 py-px font-mono text-[11px] ${
                        FEED_CHIP_TONE_CLASSES[feedChipTone(t.sourceType)]
                      }`}
                    >
                      {t.sourceName}
                    </span>
                    <span className="font-mono text-[11px] text-text-3">
                      {hhmm(t.publishedAt)} · {timeAgo(t.publishedAt, now)}
                    </span>
                    {/* NEW 基准=aiRanAt(变可见时刻,M15 批①) */}
                    {isNew(t.aiRanAt, now) && (
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
                  {/* 轻解读替代原始 summary(M12 批③;批⑥:要点折叠列表 + 蓝系关键词
                      chips——与 accent 色 AI 徽章在形状/色彩上双重区分) */}
                  {t.ai ? (
                    <>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-text-2">
                        <span className="mr-1.5 inline-block rounded-sm bg-accent-dim px-1.5 py-px align-middle font-mono text-[10px] text-accent">
                          AI 解读
                        </span>
                        {t.ai.summary}
                      </p>
                      {t.ai.points.length > 0 && (
                        <details className="mt-0.5">
                          <summary className="cursor-pointer font-mono text-[11px] text-text-3 hover:text-accent-hover">
                            关键要点 ×{t.ai.points.length}
                          </summary>
                          <ul className="mt-1 list-disc pl-5 text-[12px] leading-relaxed text-text-2">
                            {t.ai.points.map((p, i) => (
                              <li key={i}>{p}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {t.ai.keywords && t.ai.keywords.length > 0 && (
                        <p className="mt-1.5 flex flex-wrap gap-1.5">
                          {t.ai.keywords.map((k) => (
                            <span
                              key={k}
                              className="rounded-sm border border-blue/25 bg-blue/10 px-1.5 py-px font-mono text-[11px] text-blue"
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
                    {t.ai && <span>AI 生成 · 中心思想、要点与关键词,内容版权归原作者</span>}
                  </div>
                </article>
              ),
            )}
          </div>
        </section>
      ))}
      {items.length === 0 && (
        <div className="rounded-lg border border-line bg-panel px-4 py-12 text-center text-xs text-text-3">
          {today > 0
            ? // M15 批①:条目 AI 解读终态才上屏;空列=队列消化中,不展示未解读行
              `AI 解读处理中 · 今日已入库 ${today} 条,解读完成后自动上屏`
            : "暂无条目;采集首轮入库后这里开始滚动"}
        </div>
      )}
    </div>
  );
}
