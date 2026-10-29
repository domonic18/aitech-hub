"use client";

/**
 * 首页电报流 LIVE 带(M7 批⑤ 文字条目;M8 批④ 加视频行;批⑧ 视频保底槽位;
 * M10 批② 条数后台可配;M12 批③ 文字行加「AI · 中心思想 + #关键词」、
 * 批⑤ 视频行 AI 行改直出 summary;批⑥ 关键词蓝系与 AI 徽章区分;
 * 2026-10-05 验收反馈统筹改版:行网格统一 + 要点折叠块重做):
 * 头部 live-chip + 标题 + 巡检统计 + more。行网格口径与行级子件
 * (BandTime/BandAgo/BandChip/BandCover/BandPoints)已拆 TelegramBandRows
 * (技术债批⑤,行网格口径详见彼件文件头)。
 *
 * AI 要点折叠块:默认展开(<details open>);块挂行锚外(2026-10-05 反馈:
 * 要点此前只在电报流页可见;wrapper+锚分离防交互元素嵌套进 <a>)。
 * 行点击直达外链;文字行解读标识统一「AI 解读」。
 *
 * SSR 初值 + 60s 轮询(band=1 第一页与 SSR 同源——新条目 id 去重后按服务端
 * 同构序重排(M15 批③ mergeFeedItems),再截回一页上限:长驻标签页只展示
 * 最新 count 条,不随时间无限增长;轮询样板已收敛 telegram/useFeedPolling,P2-14c)。
 * 下滚自动加载已移除(2026-10-05 用户要求):带内固定一页,完整流与历史
 * 翻页走 /telegram/。
 */
import Link from "next/link";

import {
  BAND_POLL_MS,
  feedChipTone,
  formatDuration,
  hhmm,
  isNew,
  mergeFeedItems,
  platformLabel,
  timeAgo,
  type PublicTelegramItem,
} from "@/lib/telegram/feed-view";
import { trackEntryClick } from "@/lib/stats/track-click";

import { BandAgo, BandChip, BandCover, BandPoints, BandTime, ROW_GRID } from "./TelegramBandRows";
import { useFeedPolling } from "./telegram/useFeedPolling";

export default function TelegramBand({
  initialItems,
  channels,
  today,
  count,
  initialNow,
}: {
  initialItems: PublicTelegramItem[];
  channels: number;
  today: number;
  /** 后台配置的每页条数(site_config band.item_count,SSR 与轮询同源) */
  count: number;
  /**
   * SSR 水合基准时钟(服务端 Date.now()):相对时间/NEW 徽章以此渲染,
   * 水合后由 60s 轮询刷新为客户端时钟。若客户端自取 Date.now(),ISR 页
   * 水合晚于渲染数分钟,timeAgo 文本必然不一致 → React #418 水合整树回退,
   * 连带把 html[data-theme] 重灌回 light(2026-10-04 修复)。
   */
  initialNow: number;
}) {
  // 60s 轮询:只取第一页(与 SSR 同源),新条目 id 去重、同构重排后截回一页上限
  // (长驻标签页只展示最新 count 条,不随时间无限增长)
  const { items, now } = useFeedPolling({
    initialItems,
    initialNow,
    intervalMs: BAND_POLL_MS,
    buildQuery: () => `band=1&limit=${count}`,
    merge: (prev, fresh) => {
      const added = fresh.filter((i) => !prev.some((p) => p.id === i.id));
      if (added.length === 0) return prev;
      // M15 批③:mergeFeedItems 同构重排后再截回一页——「刚解读但发布较早」
      // 的行(补扫/backfill 上屏)纯前插会错误置顶,破坏倒序不变量
      return mergeFeedItems(prev, fresh).slice(0, count);
    },
  });

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
        // NEW 基准=aiRanAt(变可见时刻,M15 批①):与时间轴角标同口径
        const fresh = isNew(t.aiRanAt, now);
        const video = t.mediaType === "video" ? t.video : undefined;
        const points = t.mediaType === "video" ? (video?.ai?.points ?? []) : (t.ai?.points ?? []);
        const ago = `${fresh ? "NEW · " : ""}${timeAgo(t.publishedAt, now)}`;
        if (video) {
          // 视频行:元信息列 = 封面 + 平台/博主(窄屏仅封面,信息并入标题区首行),
          // 标题/AI 解读双行与文字行同构;行高由封面撑起。有要点时行锚 pb 收窄。
          const duration = formatDuration(video.durationSeconds);
          return (
            <div
              key={t.id}
              className="border-b border-line/55 transition-colors last:border-b-0 hover:bg-panel-2"
            >
              <a
                href={t.url}
                target="_blank"
                rel="noopener nofollow"
                onClick={() =>
                  trackEntryClick({ surface: "home", kind: "telegram", ref: t.id, target: t.url })
                }
                className={`${ROW_GRID} items-start py-3 ${points.length > 0 ? "pb-1" : ""}`}
              >
                <BandTime fresh={fresh} text={hhmm(t.publishedAt)} />
                <span className="flex min-w-0 gap-2">
                  <BandCover src={video.coverUrl} duration={duration} />
                  <span className="hidden min-w-0 flex-1 flex-col items-start gap-1 sm:flex">
                    <BandChip
                      label={platformLabel(video.platform)}
                      tone={feedChipTone(t.sourceType, video.platform)}
                    />
                    <span className="max-w-full truncate font-mono text-[11px] text-text-2">
                      @{video.blogger}
                    </span>
                  </span>
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="mb-1 flex items-center gap-1.5 font-mono text-[11px] text-text-3 sm:hidden">
                    <span className={fresh ? "text-green-hi" : ""}>{hhmm(t.publishedAt)}</span>
                    <span>{platformLabel(video.platform)}</span>
                    <span className="truncate">@{video.blogger}</span>
                  </span>
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
                <BandAgo fresh={fresh} text={ago} />
              </a>
              <BandPoints points={points} />
            </div>
          );
        }
        return (
          <div
            key={t.id}
            className="border-b border-line/55 transition-colors last:border-b-0 hover:bg-panel-2"
          >
            <a
              href={t.url}
              target="_blank"
              rel="noopener nofollow"
              onClick={() =>
                trackEntryClick({ surface: "home", kind: "telegram", ref: t.id, target: t.url })
              }
              className={`${ROW_GRID} items-start py-2.5 ${points.length > 0 ? "pb-1.5" : ""}`}
            >
              {/* 文字行首列时间双断点常显;渠道章 sm+ 落 164px 元信息列,
                  窄屏并入标题区首行(2026-10-05 反馈:窄屏定宽列挤压标题不可读) */}
              <BandTime fresh={fresh} text={hhmm(t.publishedAt)} always />
              <span className="hidden min-w-0 flex-col items-start sm:flex">
                <BandChip label={t.sourceName} tone={feedChipTone(t.sourceType)} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="mb-1 sm:hidden">
                  <BandChip label={t.sourceName} tone={feedChipTone(t.sourceType)} />
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate text-[13px] leading-normal text-text-1">
                    {t.title}
                  </span>
                  <svg className="ic ic-sm flex-none text-text-3" aria-hidden="true">
                    <use href="#i-export" />
                  </svg>
                </span>
                {/* 文字条轻解读(M12 批③):中心思想 + #关键词;批⑥ 关键词换蓝系;
                    2026-10-05 优化:标识统一为「AI 解读」(与视频行/电报流页同款) */}
                {t.ai && (
                  <span className="mt-0.5 truncate font-mono text-[11.5px] text-text-3">
                    <span className="text-accent">AI 解读</span> · {t.ai.summary}
                    {t.ai.keywords && t.ai.keywords.length > 0 && (
                      <span className="ml-1.5 text-blue">
                        {t.ai.keywords.map((k) => `#${k}`).join(" ")}
                      </span>
                    )}
                  </span>
                )}
              </span>
              <BandAgo fresh={fresh} text={ago} />
            </a>
            <BandPoints points={points} />
          </div>
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
