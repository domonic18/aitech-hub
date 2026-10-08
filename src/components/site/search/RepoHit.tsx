/**
 * 项目命中卡(K1,原型 .hit repo 变体):外链 htmlUrl,mono 仓库名 + amber 星数
 * (formatStars 口径)+ 语言/配套文章 meta + mark 高亮。RSC 纯展示。
 */
import { timeAgo } from "@/lib/telegram/feed-view";
import { formatStars } from "@/lib/github/public";
import type { RepoSearchHit } from "@/lib/search/search-view";
import Marked from "./Marked";
import { HitChip, HitMeta, HitSummary, HitTitle, HitTop, HIT_CARD_CLASS } from "./HitChrome";

export default function RepoHit({
  hit,
  terms,
}: {
  hit: RepoSearchHit;
  terms: string[];
}): React.ReactElement {
  return (
    <a href={hit.href} target="_blank" rel="noopener nofollow" className={HIT_CARD_CLASS}>
      <HitTop
        chip={<HitChip tone="accent">GitHub</HitChip>}
        date={`更新于 ${hit.dateIso ? timeAgo(hit.dateIso) : "—"}`}
        hitPct={hit.hitPct}
        semanticOnly={hit.semanticOnly}
      />
      <HitTitle>
        <span className="font-mono font-semibold">
          <Marked text={hit.fullName} terms={terms} />
          <span className="ml-2 font-normal text-[12px] text-amber">
            <svg className="ic ic-sm" aria-hidden="true">
              <use href="#i-star" />
            </svg>{" "}
            {formatStars(hit.stars)}
          </span>
        </span>
      </HitTitle>
      {hit.snippet && (
        <HitSummary>
          <Marked text={hit.snippet} terms={terms} />
        </HitSummary>
      )}
      <HitMeta>
        <span>{hit.language ?? "—"}</span>
        <span>配套文章 ×{hit.postCount}</span>
        {hit.topics.slice(0, 3).map((t) => (
          <span key={t}>#{t}</span>
        ))}
      </HitMeta>
    </a>
  );
}
