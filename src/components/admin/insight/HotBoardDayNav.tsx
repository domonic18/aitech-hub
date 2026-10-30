/**
 * 热榜卡头日期导航(P2-22 自 overview 页抽出):回看日页签 ‹ 日期 › 随卡头
 * 常驻(F11 v2 板定位置),点击回最新。回看模式下「回看 DATE ✕」与中位日签
 * 同去向(取消回看),右箭头到今日即禁用。
 */
import Link from "next/link";

import { chip, chipOff, chipOn, insightHref, shiftDay, type InsightViewParams } from "./shared";

export default function HotBoardDayNav({
  params,
  today,
}: {
  params: InsightViewParams;
  /** 北京当日 YYYY-MM-DD(回看上限) */
  today: string;
}): React.ReactElement {
  return (
    <>
      {params.day !== undefined && (
        <Link
          href={insightHref(params, { day: undefined })}
          scroll={false}
          className={chipOn}
          title="回看模式:点击回最新榜面"
        >
          回看 {params.day} ✕
        </Link>
      )}
      <Link
        href={insightHref(params, { day: shiftDay(params.day ?? today, -1) })}
        scroll={false}
        className={chipOff}
        aria-label="前一天"
      >
        ‹
      </Link>
      {params.day !== undefined ? (
        <Link
          href={insightHref(params, { day: undefined })}
          scroll={false}
          className={chipOn}
          title="回看模式:点击回最新榜面"
        >
          {params.day}
        </Link>
      ) : (
        <span className="font-mono text-[11px] text-text-2">最新</span>
      )}
      {params.day !== undefined && params.day < today ? (
        <Link
          href={insightHref(params, { day: shiftDay(params.day, 1) })}
          scroll={false}
          className={chipOff}
          aria-label="后一天"
        >
          ›
        </Link>
      ) : (
        <span className={`${chip} opacity-40`}>›</span>
      )}
    </>
  );
}
