"use client";

/**
 * 电报流视频卡(M8 批④ 混合流加视频卡;M10 批③ 原型重排;M15 批③ 自
 * TelegramTimeline 抽出——时间轴重构后壳文件守 350 行限):
 * 视频项独立卡形(原型 site-telegram .tg-item.video):竖版大封面
 * 88×157(≤sm 72×128,防盗链 no-referrer,失败降级占位)+ 播放浮层 +
 * 平台角标左上/时长左下 + 标题进卡 + AI 摘要 line-clamp-3 +
 * 互动 播/赞/评(空值整项隐藏)+ 原视频外链。
 */
import { useState } from "react";

import {
  compactCount,
  feedChipTone,
  formatDuration,
  hhmm,
  isNew,
  platformLabel,
  timeAgo,
  videoSourceName,
  FEED_CHIP_TONE_CLASSES,
  type PublicTelegramItem,
} from "@/lib/telegram/feed-view";

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
export default function VideoArticle({ t, now }: { t: PublicTelegramItem; now: number }) {
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
    <article className="grid grid-cols-[72px_1fr] gap-4 rounded-lg border border-line bg-panel p-4 shadow-sm transition-colors hover:border-line-hover hover:bg-panel-2">
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
          <span
            className={`rounded-sm border px-1.5 py-px font-mono text-[11px] ${
              FEED_CHIP_TONE_CLASSES[feedChipTone(t.sourceType, v.platform)]
            }`}
          >
            {videoSourceName(v)}
          </span>
          <span className="font-mono text-[11px] text-text-3">
            {hhmm(t.publishedAt)} · {timeAgo(t.publishedAt, now)}
          </span>
          {/* NEW 基准=aiRanAt(变可见时刻,M15 批①):视频采集周期 3h,按源发布
              时间窗口几乎永不亮;按解读完成时刻 30min 内真实可亮 */}
          {isNew(t.aiRanAt, now) && (
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
