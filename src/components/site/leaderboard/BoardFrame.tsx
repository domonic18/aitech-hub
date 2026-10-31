/**
 * 榜单节壳(M63):锚点 id、标题、数据截至、陈旧降级横幅、多源署名。
 * 模型榜/论文/热门仓库三节共用;单节可挂多个来源(模型榜合并 AA + HF)。
 */
import { LEADERBOARD_STALE_DAYS } from "@/lib/leaderboard/public";

export interface BoardSourceRef {
  label: string;
  url: string;
}

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
      {stale && (
        <p className="mt-2 rounded-sm border border-amber/30 bg-amber/10 px-3 py-2 text-[12px] text-amber">
          本期数据未更新,展示的是最近一次可用快照。
        </p>
      )}
      {children}
      {sources.length > 0 && (
        <p className="mt-3 text-[11px] text-text-3">
          来源:
          {sources.map((s, i) => (
            <span key={s.url}>
              {i > 0 && "、"}
              <a
                href={s.url}
                target="_blank"
                rel="nofollow noopener noreferrer"
                className="underline decoration-line hover:text-text-1"
              >
                {s.label}
              </a>
            </span>
          ))}
          {" · 每日采集一次,名次变动与上一可用日期比较得出"}
        </p>
      )}
    </section>
  );
}
