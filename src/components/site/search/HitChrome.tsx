/**
 * 搜索命中卡共用件(K1,原型 .hit 行):h-top(渠道章 + 日期 + 命中度)与
 * 卡壳样式收敛于此,三域 hit 组件共用防漂移。渠道章色调复用电报流
 * FEED_CHIP_TONE_CLASSES(频道章同源)。RSC 纯展示。
 */
import { FEED_CHIP_TONE_CLASSES, type FeedChipTone } from "@/lib/telegram/feed-view";

/** 卡壳:panel 底 + hover 上浮 1px(原型 .hit hover 同款) */
export const HIT_CARD_CLASS =
  "group block rounded-md border border-line bg-panel px-5 py-4 transition-[border-color,transform] hover:-translate-y-px hover:border-line-hover";

/** 渠道/平台章:mono 11px 小圆角边框章(原型 .src-tag) */
export function HitChip({
  tone,
  children,
}: {
  tone: FeedChipTone;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <span
      className={`whitespace-nowrap rounded border px-[9px] py-px font-mono text-[11px] ${FEED_CHIP_TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

/** h-top 行:章 + 日期 + 右侧命中度(原型 .h-top / .h-score) */
export function HitTop({
  chip,
  date,
  hitPct,
}: {
  chip: React.ReactNode;
  date: string;
  hitPct: number;
}): React.ReactElement {
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
      {chip}
      <span className="font-mono text-xs text-text-3">{date}</span>
      <span className="ml-auto font-mono text-[11px] text-text-3">
        命中 <b className="font-semibold text-green-hi">{hitPct}%</b>
      </span>
    </div>
  );
}

/** 标题行:group hover 随卡变 accent(原型 .hit:hover h3) */
export function HitTitle({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <h3 className="mb-1 text-base leading-normal text-text-1 group-hover:text-accent-hover">
      {children}
    </h3>
  );
}

/** 摘要行(原型 .hit p) */
export function HitSummary({ children }: { children: React.ReactNode }): React.ReactElement {
  return <p className="text-[13.5px] leading-relaxed text-text-2">{children}</p>;
}

/** meta 行(原型 .h-meta:mono 12px text-3) */
export function HitMeta({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs text-text-3">
      {children}
    </div>
  );
}
