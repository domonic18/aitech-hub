/**
 * 资讯命中卡(K1,原型 .hit / .hit.video):文字条 = 渠道章 + 标题/摘要;
 * 视频条 = 竖版封面 + 平台章 + 博主 + 「AI 解读:」前缀摘要。外链原样
 * (noopener nofollow,与电报流一致);mark 高亮 + 命中度。RSC 纯展示。
 */
import { formatCnDateTime } from "@/lib/datetime";
import {
  compactCount,
  feedChipTone,
  formatDuration,
  platformLabel,
} from "@/lib/telegram/feed-view";
import type { TelegramSearchHit } from "@/lib/search/search-view";
import HitVideoCover from "./HitVideoCover";
import Marked from "./Marked";
import { HitChip, HitMeta, HitSummary, HitTitle, HitTop, HIT_CARD_CLASS } from "./HitChrome";

/** 日期口径 MM-DD HH:mm(原型 .h-date;formatCnDateTime 北京时区,截去年份) */
function hitDate(iso: string): string {
  return formatCnDateTime(new Date(iso)).slice(5);
}

export default function TelegramHit({
  hit,
  terms,
}: {
  hit: TelegramSearchHit;
  terms: string[];
}): React.ReactElement {
  if (hit.mediaType === "video" && hit.video) {
    const v = hit.video;
    const duration = formatDuration(v.durationSeconds);
    const play = compactCount(v.engagement.play);
    return (
      <a
        href={hit.href}
        target="_blank"
        rel="noopener nofollow"
        className={`${HIT_CARD_CLASS} grid grid-cols-[48px_1fr] items-start gap-3.5 min-[960px]:grid-cols-[56px_1fr]`}
      >
        <HitVideoCover src={v.coverUrl} alt={hit.title} />
        <span className="min-w-0">
          <HitTop
            chip={
              <HitChip tone={feedChipTone(hit.sourceType, v.platform)}>
                {platformLabel(v.platform)}
              </HitChip>
            }
            date={`${hitDate(hit.dateIso ?? "")} · @${v.blogger}`}
            hitPct={hit.hitPct}
          />
          <HitTitle>
            <Marked text={hit.title} terms={terms} />
          </HitTitle>
          <HitSummary>
            {/* AI 解读前缀(原型 v-body 口径) */}
            {hit.aiSummary && <b className="mr-1 text-text-2">AI 解读:</b>}
            <Marked text={hit.snippet} terms={terms} />
          </HitSummary>
          <HitMeta>
            <span>AI 生成</span>
            {play && (
              <span className="flex items-center gap-1">
                <svg className="ic ic-sm" aria-hidden="true">
                  <use href="#i-caret-right-fill" />
                </svg>
                {play}
              </span>
            )}
          </HitMeta>
        </span>
      </a>
    );
  }
  return (
    <a href={hit.href} target="_blank" rel="noopener nofollow" className={HIT_CARD_CLASS}>
      <HitTop
        chip={<HitChip tone={feedChipTone(hit.sourceType)}>{hit.sourceName}</HitChip>}
        date={hitDate(hit.dateIso ?? "")}
        hitPct={hit.hitPct}
      />
      <HitTitle>
        <Marked text={hit.title} terms={terms} />
      </HitTitle>
      {hit.snippet && (
        <HitSummary>
          <Marked text={hit.snippet} terms={terms} />
        </HitSummary>
      )}
      <HitMeta>
        <span className="flex items-center gap-1">
          <svg className="ic ic-sm" aria-hidden="true">
            <use href="#i-export" />
          </svg>
          原文
        </span>
        {hit.aiSummary && <span>AI 摘要已入库</span>}
      </HitMeta>
    </a>
  );
}
