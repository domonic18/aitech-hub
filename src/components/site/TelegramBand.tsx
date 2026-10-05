"use client";

/**
 * 首页电报流 LIVE 带(M7 批⑤ 文字条目;M8 批④ 加视频行;批⑧ 视频保底槽位;
 * M10 批② 条数后台可配;M12 批③ 文字行加「AI · 中心思想 + #关键词」、
 * 批⑤ 视频行 AI 行改直出 summary;批⑥ 关键词蓝系与 AI 徽章区分;
 * 2026-10-05 验收反馈统筹改版:行网格统一 + 要点折叠块重做):
 * 头部 live-chip + 标题 + 巡检统计 + more。
 *
 * 行网格统一口径(ROW_GRID,文字/视频行共用一套模板,子元素按列序渲染、
 * 免 col-start 显式定位;隐藏项随断点进出网格不破坏 auto-placement):
 *   sm+ [74px 时间 | 164px 元信息 | 1fr 标题 | auto 相对时间] gap-x-3 px-5
 *     → 标题列起点 20+74+12+164+12 = 282px;
 *   窄屏 [54px | 1fr 标题] → 20+54+12 = 86px。
 *   文字行:首列时间(双断点常显)/ 元信息列渠道章(窄屏并入标题区首行)/
 *   标题+「AI 解读 · 摘要 #关键词」;视频行:元信息列 = 封面 + 平台/博主
 *   (窄屏仅封面,博主信息并入标题区首行),封面 54×95 撑行高。
 *   两类行标题列起点逐断点一致(2026-10-05 反馈:视频标题与文字标题不对齐)。
 *
 * AI 要点折叠块(BandPoints):默认展开(<details open>);summary 用 chevron
 * 随开合旋转 90° + hover 反馈 + ×N 计数章替代原生 ▶(反馈:交互不醒目);
 * 块复用 ROW_GRID 取标题列(col-start-2/3 结构对齐,行网格改动零联动);
 * 有要点时行锚 pb 收窄,消解要点与 AI 解读间大留白(反馈:间距过大)。
 * 块挂行锚外(2026-10-05 反馈:要点此前只在电报流页可见;wrapper+锚分离
 * 防交互元素嵌套进 <a>)。行点击直达外链;文字行解读标识统一「AI 解读」。
 *
 * SSR 初值 + 60s 轮询(band=1 第一页与 SSR 同源——新条目按 id 去重前插,
 * 前插后截回一页上限:长驻标签页只展示最新 count 条,不随时间无限增长)。
 * 下滚自动加载已移除(2026-10-05 用户要求):带内固定一页,完整流与历史
 * 翻页走 /telegram/。
 */
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  BAND_POLL_MS,
  formatDuration,
  hhmm,
  isNew,
  platformLabel,
  timeAgo,
  type PublicTelegramItem,
} from "@/lib/telegram/feed-view";

/** 行网格统一口径——BandPoints 依赖同模板取标题列,改动时两处同改(见文件头)。 */
const ROW_GRID = "grid grid-cols-[54px_1fr] gap-x-3 px-5 sm:grid-cols-[74px_164px_1fr_auto]";

/** 发布时间戳:视频行首列仅 sm+(窄屏首列让给封面,时间并入标题区首行);
 * 文字行首列双断点常显(always)。fresh 绿色高亮。 */
function BandTime({ fresh, text, always }: { fresh: boolean; text: string; always?: boolean }) {
  return (
    <span
      className={`flex-none font-mono text-xs ${always ? "" : "hidden sm:block"} ${
        fresh ? "text-green-hi" : "text-text-3"
      }`}
    >
      {text}
    </span>
  );
}

/** 相对时间(尾部列,窄屏隐;fresh 加 NEW 前缀绿色高亮) */
function BandAgo({ fresh, text }: { fresh: boolean; text: string }) {
  return (
    <span
      className={`hidden flex-none justify-self-end whitespace-nowrap font-mono text-[11px] sm:block ${
        fresh ? "text-green-hi" : "text-text-3"
      }`}
    >
      {text}
    </span>
  );
}

/** 渠道/平台章(bg-panel-2 小圆角章;放在定宽列时随列宽,窄屏标题区内收口) */
function BandChip({ label }: { label: string }) {
  return (
    <span className="max-w-full truncate rounded-sm bg-panel-2 px-1.5 py-px text-center text-[11px] text-text-2">
      {label}
    </span>
  );
}

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

/** AI 要点折叠块(与电报流页「关键要点 ×N」同款数据):默认展开;复用 ROW_GRID
 * 取标题列(窄屏 col2/sm+ col3)与行标题结构化对齐;summary chevron 旋转 +
 * hover 反馈(-mx-1.5 抵消内边距,使 caret 落在标题列起点)。 */
function BandPoints({ points }: { points: readonly string[] }) {
  if (points.length === 0) return null;
  return (
    <div className={`${ROW_GRID} pb-2.5`}>
      <details open className="group col-start-2 sm:col-start-3">
        <summary className="-mx-1.5 flex cursor-pointer list-none items-center gap-1.5 rounded-sm px-1.5 py-1 text-[11px] text-text-3 transition-colors hover:bg-panel hover:text-text-1 [&::-webkit-details-marker]:hidden">
          <svg
            className="ic ic-sm flex-none text-text-3 transition-transform duration-200 group-open:rotate-90"
            aria-hidden="true"
          >
            <use href="#i-caret-right-fill" />
          </svg>
          <span className="font-medium">关键要点</span>
          <span className="rounded-full bg-panel-2 px-1.5 font-mono text-[10px] leading-4">
            ×{points.length}
          </span>
        </summary>
        <ul className="mt-1 list-disc pl-5 text-[12px] leading-relaxed text-text-2">
          {points.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

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
  const [items, setItems] = useState(initialItems);
  const [now, setNow] = useState(initialNow);

  // 60s 轮询:只取第一页(与 SSR 同源),新条目按 id 去重前插后截回一页上限
  // (长驻标签页只展示最新 count 条,不随时间无限增长)
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
            return added.length > 0 ? [...added, ...prev].slice(0, count) : prev;
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
        const points = t.mediaType === "video" ? (video?.ai?.points ?? []) : (t.ai?.points ?? []);
        const ago = `${fresh ? "NEW · " : ""}${timeAgo(t.publishedAt, now)}`;
        if (video) {
          // 视频行:元信息列 = 封面 + 平台/博主(窄屏仅封面,信息并入标题区首行),
          // 标题/AI 解读双行与文字行同构;行高由封面撑起。有要点时行锚 pb 收窄。
          const duration = formatDuration(video.durationSeconds);
          return (
            <div key={t.id} className="border-b border-line/55 last:border-b-0">
              <a
                href={t.url}
                target="_blank"
                rel="noopener nofollow"
                className={`${ROW_GRID} items-start py-3 hover:bg-panel-2 ${
                  points.length > 0 ? "pb-1" : ""
                }`}
              >
                <BandTime fresh={fresh} text={hhmm(t.publishedAt)} />
                <span className="flex min-w-0 gap-2">
                  <BandCover src={video.coverUrl} duration={duration} />
                  <span className="hidden min-w-0 flex-1 flex-col items-start gap-1 sm:flex">
                    <BandChip label={platformLabel(video.platform)} />
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
          <div key={t.id} className="border-b border-line/55 last:border-b-0">
            <a
              href={t.url}
              target="_blank"
              rel="noopener nofollow"
              className={`${ROW_GRID} items-start py-2.5 hover:bg-panel-2 ${
                points.length > 0 ? "pb-1.5" : ""
              }`}
            >
              {/* 文字行首列时间双断点常显;渠道章 sm+ 落 164px 元信息列,
                  窄屏并入标题区首行(2026-10-05 反馈:窄屏定宽列挤压标题不可读) */}
              <BandTime fresh={fresh} text={hhmm(t.publishedAt)} always />
              <span className="hidden min-w-0 flex-col items-start sm:flex">
                <BandChip label={t.sourceName} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="mb-1 sm:hidden">
                  <BandChip label={t.sourceName} />
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
