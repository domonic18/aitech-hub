"use client";

/**
 * 首页电报流 LIVE 带(M7 批⑤ 文字条目;M8 批④ 加视频行;批⑧ 视频保底槽位;
 * M10 批② 条数后台可配 + 下滚加载更多;M12 批③ 文字行加「AI · 中心思想 + #关键词」、
 * 批⑤ 视频行 AI 行改直出 summary;批⑥ 关键词蓝系与 AI 徽章区分):
 * 头部 live-chip + 标题 + 巡检统计 + more;行四列网格 tm/sr/ti/ag(sm+ 74/108/1fr/auto;
 * 窄屏 2026-10-05 反馈改版:时间+渠道缩一行小字、标题独占整行——定宽列挤压标题不可读,
 * 原型 @media 已同步);视频行按原型 site-home .tg-row.video 五列(tm/thumb/pf/vt/ag):
 * 54×95 竖版封面(play 蒙层 + 时长横条,no-referrer 防盗链,失败降级播放占位块)+
 * pf 平台章/博主(窄屏隐)+ 标题与「AI 解读 · 概括」双行;窄屏降 54px+1fr 双列。
 * 行高由封面撑起。SSR 初值 + 60s 轮询(band=1 第一页与 SSR 同源——新条目按 id 去重
 * 前插,保留用户已展开的尾部)+ 底部哨兵 IntersectionObserver 自动加载下一页(服务端
 * nextOffset 游标翻页,保底视频只占展示位不占游标;返回条数 < count 判定到底)。
 * 行点击直达外链。
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  BAND_POLL_MS,
  formatDuration,
  hhmm,
  isNew,
  platformLabel,
  timeAgo,
  type PublicTelegramItem,
} from "@/lib/telegram/feed-view";

/** 带内竖版封面(原型 .tg-row.video .thumb 口径:54×95 圆角 6、play 蒙层、
 * 底部时长横条 inset 3px);失败/无封面降级为播放占位块(不叠蒙层)。 */
function BandCover({ src, duration }: { src: string | null; duration: string | null }) {
  const [failed, setFailed] = useState(false);
  if (src === null || failed) {
    return (
      <span className="flex h-[95px] w-[54px] flex-none items-center justify-center rounded-md border border-line bg-panel-2 text-text-3">
        <svg className="ic ic-lg" aria-hidden="true">
          <use href="#i-caret-right-fill" />
        </svg>
      </span>
    );
  }
  return (
    <span className="relative h-[95px] w-[54px] flex-none overflow-hidden rounded-md border border-line bg-panel-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- 平台图床外链,不走 next/image 优化域 */}
      <img
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
      <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-white">
        <svg className="ic" aria-hidden="true">
          <use href="#i-caret-right-fill" />
        </svg>
      </span>
      {duration && (
        <span className="absolute inset-x-[3px] bottom-[3px] rounded-[3px] bg-black/70 text-center font-mono text-[9.5px] leading-[14px] text-white">
          {duration}
        </span>
      )}
    </span>
  );
}

export default function TelegramBand({
  initialItems,
  initialNextOffset,
  channels,
  today,
  count,
  initialNow,
}: {
  initialItems: PublicTelegramItem[];
  /** SSR 首屏已消费的混排游标(保底视频不占游标);后续翻页以服务端 nextOffset 为准 */
  initialNextOffset: number;
  channels: number;
  today: number;
  /** 后台配置的每页条数(site_config band.item_count,SSR 与轮询/翻页同源) */
  count: number;
  /**
   * SSR 水合基准时钟(服务端 Date.now()):相对时间/NEW 徽章以此渲染,
   * 水合后由 60s 轮询刷新为客户端时钟。若客户端自取 Date.now(),ISR 页
   * 水合晚于渲染数分钟,timeAgo 文本必然不一致 → React #418 水合整树回退,
   * 连带把 html[data-theme] 重灌回 light(2026-10-04 修复)。
   */
  initialNow: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [nextOffset, setNextOffset] = useState(initialNextOffset);
  const [now, setNow] = useState(initialNow);
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
    const t = setInterval(() => void tick(), BAND_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [count]);

  // 下滚加载更多:底部哨兵进入视口(预载 200px)取下一页;返回不足一页判定到底。
  // IO 只在穿越边沿触发:哨兵滞留视口(带矮/快速滚动)时 loading 落定不会重发,
  // 故记最近相交态,loading 结束仍在视口则续拉(failure 时清零,待新的穿越再试)
  const intersectingRef = useRef(false);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || exhausted) return;
    const io = new IntersectionObserver(
      (entries) => {
        intersectingRef.current = entries.some((e) => e.isIntersecting);
        if (intersectingRef.current) void loadMore();
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- items.length 变化后以最新闭包重挂哨兵
  }, [exhausted, items.length, count, loading]);

  useEffect(() => {
    if (!loading && intersectingRef.current && !exhausted) void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loading 落定即续拉,loadMore 读最新 state
  }, [loading, exhausted]);

  const loadMore = async (): Promise<void> => {
    if (loading || exhausted) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/telegram/public?band=1&offset=${nextOffset}&limit=${count}`, {
        cache: "no-store",
      });
      const body = (await res.json()) as {
        code: number;
        data?: { items: PublicTelegramItem[]; nextOffset: number };
      };
      if (body.code === 0 && body.data) {
        const page = body.data.items;
        setItems((prev) => {
          const seen = new Set(prev.map((i) => i.id));
          const added = page.filter((i) => !seen.has(i.id));
          return added.length > 0 ? [...prev, ...added] : prev;
        });
        setNextOffset(body.data.nextOffset);
        if (page.length < count) setExhausted(true);
      } else {
        setExhausted(true);
      }
    } catch {
      /* 拉取失败静默:清相交态,待哨兵新的穿越边沿再试(防失败热循环) */
      intersectingRef.current = false;
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
        if (video) {
          // 视频行(原型 site-home .tg-row.video 口径):54×95 竖版封面独立列 +
          // 平台章/博主列(pf,窄屏隐)+ 标题/AI 概括双行(vt)+ 右侧相对时间;
          // 窄屏降 54px+1fr 双列(隐 tm/pf/ag),行高由封面撑起
          const duration = formatDuration(video.durationSeconds);
          return (
            <a
              key={t.id}
              href={t.url}
              target="_blank"
              rel="noopener nofollow"
              className="grid grid-cols-[54px_1fr] items-center gap-3.5 border-b border-line/55 px-5 py-3 last:border-b-0 hover:bg-panel-2 sm:grid-cols-[74px_54px_96px_1fr_auto]"
            >
              <span
                className={`hidden flex-none font-mono text-xs sm:block ${
                  fresh ? "text-green-hi" : "text-text-3"
                }`}
              >
                {hhmm(t.publishedAt)}
              </span>
              <BandCover src={video.coverUrl} duration={duration} />
              <span className="hidden min-w-0 flex-none flex-col items-start gap-1 sm:flex">
                <span className="rounded-sm bg-panel-2 px-1.5 py-px text-center text-[11px] text-text-2">
                  {platformLabel(video.platform)}
                </span>
                <span className="max-w-full truncate font-mono text-[11px] text-text-2">
                  @{video.blogger}
                </span>
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm leading-normal text-text-1">{t.title}</span>
                {video.ai && (
                  <span className="mt-0.5 truncate font-mono text-[11.5px] text-text-3">
                    {/* 批⑤(2026-10-05 验收反馈):带内直出 summary 与电报流详情统一——
                        topic 是 ≤20 字主题标签,每日要闻速递类视频恒产出「全球AI圈今日
                        要闻速递」级泛化词,把有实质内容的 summary 挡在带外 */}
                    <span className="text-accent">AI 解读</span> · {video.ai.summary}
                  </span>
                )}
              </span>
              <span
                className={`hidden flex-none justify-self-end whitespace-nowrap font-mono text-[11px] sm:block ${
                  fresh ? "text-green-hi" : "text-text-3"
                }`}
              >
                {fresh ? "NEW · " : ""}
                {timeAgo(t.publishedAt, now)}
              </span>
            </a>
          );
        }
        return (
          <a
            key={t.id}
            href={t.url}
            target="_blank"
            rel="noopener nofollow"
            className="block border-b border-line/55 px-5 py-2.5 last:border-b-0 hover:bg-panel-2 sm:grid sm:grid-cols-[74px_108px_1fr_auto] sm:items-center sm:gap-3"
          >
            {/* 窄屏(2026-10-05 反馈):64+92 定宽列在手机宽只剩 ~170px,标题截到
                七八字——时间+渠道缩为一行小字、标题独占整行;sm+ 回到原型四列
                (sm:contents 让包裹层退场,子元素直接落格) */}
            <span className="flex items-center gap-2 sm:contents">
              <span
                className={`flex-none font-mono text-xs ${fresh ? "text-green-hi" : "text-text-3"}`}
              >
                {hhmm(t.publishedAt)}
              </span>
              <span className="max-w-[140px] truncate rounded-sm bg-panel-2 px-1.5 py-px text-center text-[11px] text-text-2">
                {t.sourceName}
              </span>
            </span>
            <span className="mt-1 flex min-w-0 flex-col sm:mt-0">
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate text-[13px] leading-normal text-text-1">
                  {t.title}
                </span>
                <svg className="ic ic-sm flex-none text-text-3" aria-hidden="true">
                  <use href="#i-export" />
                </svg>
              </span>
              {/* 文字条轻解读(M12 批③):中心思想 + #关键词;批⑥ 关键词换蓝系,
                  与 accent 色「AI」标记区分(tag vs 解读徽章一眼可辨) */}
              {t.ai && (
                <span className="mt-0.5 truncate font-mono text-[11.5px] text-text-3">
                  <span className="text-accent">AI</span> · {t.ai.summary}
                  {t.ai.keywords && t.ai.keywords.length > 0 && (
                    <span className="ml-1.5 text-blue">
                      {t.ai.keywords.map((k) => `#${k}`).join(" ")}
                    </span>
                  )}
                </span>
              )}
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
