/**
 * 教程命中卡(K1,原型 .hit + .chip-blogger):站内文章链(唯一出口 postPath),
 * 「博主个人」绿章 + 日期 + 命中度 + mark 高亮 + 阅读量/标签 meta。RSC 纯展示。
 */
import Link from "next/link";

import { formatCnDate } from "@/lib/datetime";
import { compactCount } from "@/lib/telegram/feed-view";
import type { PostSearchHit } from "@/lib/search/search-view";
import Marked from "./Marked";
import { HitMeta, HitSummary, HitTitle, HitTop, HIT_CARD_CLASS } from "./HitChrome";

export default function PostHit({
  hit,
  terms,
}: {
  hit: PostSearchHit;
  terms: string[];
}): React.ReactElement {
  const views = compactCount(hit.viewsCount);
  return (
    <Link href={hit.href} className={HIT_CARD_CLASS}>
      <HitTop
        chip={
          // 原型 .chip-blogger 绿章口径(FEED_CHIP_TONE_CLASSES 无 green 档,就地声明)
          <span className="whitespace-nowrap rounded border border-green/30 bg-green/10 px-[9px] py-px font-mono text-[11px] text-green-hi">
            博主个人
          </span>
        }
        date={hit.dateIso ? formatCnDate(new Date(hit.dateIso)) : ""}
        hitPct={hit.hitPct}
        semanticOnly={hit.semanticOnly}
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
        {views && (
          <span className="flex items-center gap-1">
            <svg className="ic ic-sm" aria-hidden="true">
              <use href="#i-eye" />
            </svg>
            {views}
          </span>
        )}
        {hit.tags.slice(0, 3).map((t) => (
          <span key={t}>#{t}</span>
        ))}
      </HitMeta>
    </Link>
  );
}
