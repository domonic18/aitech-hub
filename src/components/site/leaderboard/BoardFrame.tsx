/**
 * 榜单节壳(M63):锚点 id、标题、数据截至、陈旧降级横幅、来源署名。
 * 能力与价格 / HF 热门模型 / 热门仓库三节共用。
 *
 * 署名位置(M63 v2.1):来源 chip 放标题区、正文之前——站名 + 域名 + ↗ 一眼可辨、
 * 一键回原站,转载合规与「数据以原站为准」都落在这里;不再塞在节尾小字里。
 */
import { LEADERBOARD_STALE_DAYS } from "@/lib/leaderboard/public";

import { SourceLink, type BoardSourceRef } from "./shared";

export type { BoardSourceRef };

export function BoardFrame({
  id,
  title,
  hint,
  capturedDate,
  staleDays,
  sources,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  capturedDate: string | null;
  staleDays: number;
  sources: BoardSourceRef[];
  children: React.ReactNode;
}): React.ReactElement {
  const stale = staleDays > LEADERBOARD_STALE_DAYS;
  return (
    <section id={id} className="scroll-mt-24">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-semibold text-text-1">{title}</h2>
        {capturedDate !== null && (
          <p className="font-mono text-[11px] text-text-3">
            数据截至 {capturedDate}
            {staleDays > 0 && `(距今 ${staleDays} 天)`}
          </p>
        )}
      </div>
      {hint !== undefined && <p className="mt-1 text-[12px] leading-relaxed text-text-3">{hint}</p>}
      {sources.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11.5px] text-text-3">
          <span>数据来源</span>
          {sources.map((s) => (
            <SourceLink key={s.url} source={s} />
          ))}
          <span>每日采集快照,名次与内容以原站为准</span>
        </p>
      )}
      {stale && (
        <p className="mt-2 rounded-sm border border-amber/30 bg-amber/10 px-3 py-2 text-[12px] text-amber">
          本期数据未更新,展示的是最近一次可用快照。
        </p>
      )}
      {children}
    </section>
  );
}
