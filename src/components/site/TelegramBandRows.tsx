"use client";

/**
 * 首页电报流 LIVE 带的行级子件(技术债批⑤ 自 TelegramBand 拆出):
 * 行网格模板 + 时间/相对时间/渠道章/封面/AI 要点折叠块五件。
 * 行网格统一口径(ROW_GRID,文字/视频行共用一套模板,子元素按列序渲染、
 * 免 col-start 显式定位;隐藏项随断点进出网格不破坏 auto-placement):
 *   sm+ [74px 时间 | 164px 元信息 | 1fr 标题 | auto 相对时间] gap-x-3 px-5
 *     → 标题列起点 20+74+12+164+12 = 282px;
 *   窄屏 [54px | 1fr 标题] → 20+54+12 = 86px。
 *   文字行:首列时间(双断点常显)/ 元信息列渠道章(窄屏并入标题区首行)/
 *   标题+「AI 解读 · 摘要 #关键词」;视频行:元信息列 = 封面 + 平台/博主
 *   (窄屏仅封面,博主信息并入标题区首行),封面 54×95 撑行高。
 *   两类行标题列起点逐断点一致(2026-10-05 反馈:视频标题与文字标题不对齐)。
 */
import { useState } from "react";

import { FEED_CHIP_TONE_CLASSES, type FeedChipTone } from "@/lib/telegram/feed-view";

import { TelegramPoints } from "./telegram/TelegramPoints";

/** 行网格统一口径——BandPoints 依赖同模板取标题列,改动时两处同改。 */
export const ROW_GRID = "grid grid-cols-[54px_1fr] gap-x-3 px-5 sm:grid-cols-[74px_164px_1fr_auto]";

/** 发布时间戳:视频行首列仅 sm+(窄屏首列让给封面,时间并入标题区首行);
 * 文字行首列双断点常显(always)。fresh 绿色高亮。 */
export function BandTime({
  fresh,
  text,
  always,
}: {
  fresh: boolean;
  text: string;
  always?: boolean;
}) {
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
export function BandAgo({ fresh, text }: { fresh: boolean; text: string }) {
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

/** 渠道/平台章(带边框浅底色章,色调随渠道类型/平台;定宽列内随列宽,窄屏标题区内收口) */
export function BandChip({ label, tone }: { label: string; tone: FeedChipTone }) {
  return (
    <span
      className={`max-w-full truncate rounded-sm border px-1.5 py-px text-center text-[11px] ${FEED_CHIP_TONE_CLASSES[tone]}`}
    >
      {label}
    </span>
  );
}

/** 带内竖版封面(原型 .tg-row.video .thumb 口径:54×95 圆角 6、play 蒙层、
 * 底部时长横条 inset 3px);失败/无封面降级为播放占位块(不叠蒙层)。 */
export function BandCover({ src, duration }: { src: string | null; duration: string | null }) {
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

/** AI 要点折叠块(P2-14a:details 富 summary/要点列表已收敛 telegram/TelegramPoints
 * band 变体;本件只保留行网格外壳——复用 ROW_GRID 取标题列(窄屏 col2/sm+ col3)
 * 与行标题结构化对齐)。 */
export function BandPoints({ points }: { points: readonly string[] }) {
  if (points.length === 0) return null;
  return (
    <div className={`${ROW_GRID} pb-2.5`}>
      <TelegramPoints variant="band" points={points} />
    </div>
  );
}
