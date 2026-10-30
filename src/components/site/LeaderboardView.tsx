/**
 * /leaderboards/ 榜单视图(M58 批③,RSC 零客户端 JS):全部榜单纵向排列,
 * 顶部锚点 chips 做秒跳——不用 URL query 是为了保住 ISR 静态产物
 * (App Router 里读 searchParams 即转动态渲染),全量行同时直出进 HTML,
 * SEO 与首屏一致(方案 §6.3「SSR 直出当页数据」)。
 * 移动端表格转卡片列表;数据陈旧出降级横幅(采集失败不静默腐烂)。
 */
import { PageHeader } from "@/components/site/PageHeader";
import { LEADERBOARD_ENTITY_LABELS, type LeaderboardEntityType } from "@/lib/leaderboard/constants";
import {
  LEADERBOARD_STALE_DAYS,
  type PublicLeaderboard,
  type PublicLeaderboards,
  type PublicLeaderboardRow,
} from "@/lib/leaderboard/public";

/** 名次变动标记:正=上升,负=下降,0=持平,空=新入榜 */
function DeltaMark({ delta }: { delta: number | null }): React.ReactElement {
  if (delta === null) return <span className="font-mono text-[11px] text-accent">NEW</span>;
  if (delta > 0) return <span className="font-mono text-[11px] text-green">▲{delta}</span>;
  if (delta < 0) return <span className="font-mono text-[11px] text-red">▼{-delta}</span>;
  return <span className="font-mono text-[11px] text-text-3">–</span>;
}

function scoreText(row: PublicLeaderboardRow): string {
  if (row.score === null) return "—";
  const n = Number.isInteger(row.score) ? String(row.score) : row.score.toFixed(2);
  return row.scoreUnit === null ? n : `${n} ${row.scoreUnit}`;
}

function typeLabel(t: LeaderboardEntityType): string {
  return LEADERBOARD_ENTITY_LABELS[t] ?? t;
}

function EntityLink({ row }: { row: PublicLeaderboardRow }): React.ReactElement {
  const label = row.entityName === "" ? row.entityKey : row.entityName;
  if (row.url === "") return <span className="text-[13px] text-text-1">{label}</span>;
  return (
    <a
      href={row.url}
      target="_blank"
      rel="nofollow noopener noreferrer"
      className="text-[13px] text-text-1 hover:text-accent-hover"
    >
      {label}
    </a>
  );
}

function BoardSection({ board }: { board: PublicLeaderboard }): React.ReactElement {
  const stale = board.staleDays > LEADERBOARD_STALE_DAYS;
  return (
    <section id={`board-${board.key}`} className="scroll-mt-24">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-text-1">{board.board}</h2>
        <p className="font-mono text-[11px] text-text-3">
          数据截至 {board.capturedDate}
          {board.staleDays > 0 && `(距今 ${board.staleDays} 天)`}
        </p>
      </div>
      {stale && (
        <p className="mt-2 rounded-sm border border-amber/30 bg-amber/10 px-3 py-2 text-[12px] text-amber">
          本期数据未更新,展示的是最近一次可用快照。
        </p>
      )}

      {/* 桌面表格 */}
      <div className="mt-3 hidden overflow-hidden rounded-lg border border-line bg-panel sm:block">
        <table className="w-full table-fixed text-left">
          <thead>
            <tr className="border-b border-line/70 font-mono text-[11px] text-text-3">
              <th className="w-14 px-3 py-2 font-normal">名次</th>
              <th className="w-14 px-3 py-2 font-normal">变动</th>
              <th className="px-3 py-2 font-normal">名称</th>
              <th className="w-28 px-3 py-2 font-normal">类型</th>
              <th className="w-36 px-3 py-2 font-normal">厂商/作者</th>
              <th className="w-40 px-3 py-2 font-normal">分数</th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row) => (
              <tr key={row.entityKey} className="border-b border-line/40 last:border-b-0">
                <td className="px-3 py-2 font-mono text-[12.5px] text-text-2">{row.rank}</td>
                <td className="px-3 py-2">
                  <DeltaMark delta={row.delta} />
                </td>
                <td className="min-w-0 px-3 py-2">
                  <span className="block truncate">
                    <EntityLink row={row} />
                  </span>
                </td>
                <td className="px-3 py-2 text-[12px] text-text-3">{typeLabel(row.entityType)}</td>
                <td className="min-w-0 px-3 py-2">
                  <span className="block truncate text-[12px] text-text-2">
                    {row.vendor ?? "—"}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-[12px] text-text-2">{scoreText(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 移动端卡片 */}
      <ol className="mt-3 space-y-2 sm:hidden">
        {board.rows.map((row) => (
          <li key={row.entityKey} className="rounded-lg border border-line bg-panel px-3 py-2.5">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 w-6 flex-none font-mono text-[12px] text-text-3">
                {row.rank}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-snug">
                  <EntityLink row={row} />
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-3">
                  <DeltaMark delta={row.delta} />
                  <span>{typeLabel(row.entityType)}</span>
                  {row.vendor !== null && <span className="truncate">{row.vendor}</span>}
                  <span className="font-mono">{scoreText(row)}</span>
                </span>
              </span>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-2 text-[11px] text-text-3">
        来源:
        <a
          href={board.sourceUrl}
          target="_blank"
          rel="nofollow noopener noreferrer"
          className="underline decoration-line hover:text-text-1"
        >
          {board.label}
        </a>
        {" · 每日采集一次,名次变动与上一可用日期比较得出"}
      </p>
    </section>
  );
}

export default function LeaderboardView({
  data,
}: {
  data: PublicLeaderboards;
}): React.ReactElement {
  const empty = data.boards.length === 0;
  return (
    <PageHeader
      eyebrow="DATA · 榜单"
      title="模型榜单"
      description="AI 模型与社区热度的多榜聚合:智能指数、模型趋势、最新论文与热门仓库,每日采集,名次变动与上一可用日期比较。数据来自各榜单官方页面,以原始来源为准。"
    >
      {empty ? (
        <p className="mt-6 rounded-lg border border-dashed border-line bg-panel px-4 py-10 text-center text-[13px] text-text-3">
          榜单数据采集中(首次采集完成后自动上架)
        </p>
      ) : (
        <>
          <nav className="mt-5 flex flex-wrap gap-1.5">
            {data.boards.map((b) => (
              <a
                key={b.key}
                href={`#board-${b.key}`}
                className="rounded-sm bg-panel-2 px-3 py-1.5 text-[12.5px] text-text-2 hover:text-text-1"
              >
                {b.board}
              </a>
            ))}
          </nav>
          <p className="mt-3 font-mono text-[11px] text-text-3">最新数据日期 {data.asOf}</p>
          <div className="mt-6 space-y-10">
            {data.boards.map((b) => (
              <BoardSection key={b.key} board={b} />
            ))}
          </div>
        </>
      )}
    </PageHeader>
  );
}
