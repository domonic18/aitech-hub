/**
 * 三域分组命中区(K1,原型 site-search 分组结构):资讯/教程/项目纵排,
 * 组头 = 组名 + (教程组「博主个人」章)+ mono 计数标 + g-more 链接;
 * 条目按域分派 hit 组件。RSC 纯展示,服务端直出真实 HTML(SSR 即时可分享)。
 */
import Link from "next/link";

import type { UnifiedSearchResult } from "@/lib/search/search-view";
import PostHit from "./PostHit";
import RepoHit from "./RepoHit";
import TelegramHit from "./TelegramHit";

const ORDER: Array<"telegram" | "post" | "repo"> = ["telegram", "post", "repo"];

export default function SearchHits({
  groups,
  terms,
}: {
  groups: UnifiedSearchResult["groups"];
  terms: string[];
}): React.ReactElement {
  const shown = ORDER.map((d) => groups[d]).filter((g) => g.items.length > 0);
  return (
    <div>
      {shown.map((g) => (
        <section key={g.domain} aria-label={g.label}>
          <div className="mb-3 mt-[26px] flex flex-wrap items-baseline gap-3">
            <h2 className="text-base font-bold">{g.label}</h2>
            <span className="font-mono text-[11.5px] tracking-wide text-text-3">
              [{g.tagKey} · {g.total} 条命中]
            </span>
            <Link
              href={g.moreHref}
              className="ml-auto text-[12.5px] text-text-2 hover:text-accent-hover"
            >
              {g.moreLabel}
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {g.items.map((hit) => {
              switch (hit.domain) {
                case "telegram":
                  return <TelegramHit key={hit.id} hit={hit} terms={terms} />;
                case "post":
                  return <PostHit key={hit.id} hit={hit} terms={terms} />;
                case "repo":
                  return <RepoHit key={hit.id} hit={hit} terms={terms} />;
              }
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
