/**
 * F24 候选治理(discovery?t=candidates):发现任务产出的人工终审台——KPI 4 卡
 * (待审/今日新增/7 日采纳率/相似重复簇)+ seg 待审|已采纳|已拒绝|全部 + 来源
 * 筛选 + 待审卡流(词·来源·时间·信号数·相似提示 amber·采纳/合并/拒绝)。
 * 取数与相似度现算在 lib/discovery/candidate-words(W0),动作 client 直发
 * keywords API。
 */
import Link from "next/link";

import CandidateWordActions from "@/components/admin/discovery/CandidateWordActions";
import AdminPagination from "@/components/admin/AdminPagination";
import { parseListSegment, parsePage } from "@/lib/admin/list";
import {
  listWordCandidates,
  WORD_CANDIDATE_SOURCES,
  type CandidateWordSegment,
} from "@/lib/discovery/candidate-words";
import { formatCnDate, formatCnTime } from "@/lib/datetime";

const PAGE_SIZE = 8; // 与 lib PAGE_SIZE 对齐(板「本页 8 条」)

const SEGMENTS: ReadonlyArray<[CandidateWordSegment, string]> = [
  ["pending", "待审"],
  ["active", "已采纳"],
  ["dismissed", "已拒绝"],
  ["all", "全部"],
];

function Kpi({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-panel px-4 py-3" title={title}>
      <div className="text-xs text-text-3">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold text-text-1">{value}</div>
    </div>
  );
}

/** 卡 meta 时间:今天/昨天 带时刻,更早显 MM-DD(北京日界) */
function relDay(at: Date): string {
  const day = formatCnDate(at);
  if (day === formatCnDate(new Date())) return `今天 ${formatCnTime(at)}`;
  if (day === formatCnDate(new Date(Date.now() - 86_400_000))) return `昨天 ${formatCnTime(at)}`;
  return day.slice(5);
}

function boardHref(seg: CandidateWordSegment, page: number, source?: string): string {
  const sp = new URLSearchParams({ t: "candidates" });
  if (seg !== "pending") sp.set("status", seg);
  if (source) sp.set("source", source);
  if (page > 1) sp.set("page", String(page));
  return `/admin/insight/discovery/?${sp.toString()}`;
}

export default async function CandidateWordsBoard({
  searchParams,
}: {
  searchParams: { status?: string; page?: string; source?: string };
}): Promise<React.ReactElement> {
  const segment = parseListSegment(
    SEGMENTS.map(([s]) => s),
    searchParams.status,
    "pending",
  ) as CandidateWordSegment;
  const page = parsePage(searchParams.page);
  const source = WORD_CANDIDATE_SOURCES.some(([v]) => v !== "" && v === searchParams.source)
    ? (searchParams.source as string)
    : undefined;

  const board = await listWordCandidates({ segment, page, source });
  const totalPages = Math.max(1, Math.ceil(board.total / PAGE_SIZE));
  const { kpi } = board;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">候选治理</h2>
        <p className="mt-0.5 text-xs text-text-3">
          发现任务产出在此人工终审 · 采纳 → 入种子词库 · 重复词合并归簇 · 拒绝后不再产出
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="待审候选" value={String(kpi.pending)} title="pending 状态词" />
        <Kpi label="今日新增" value={`+${kpi.todayNew}`} title="今日入池词(北京日界)" />
        <Kpi
          label="7 日采纳率"
          value={kpi.adoptRate7d === null ? "—" : `${Math.round(kpi.adoptRate7d * 100)}%`}
          title="近 7 日终审中采纳占比;无终审样本显 —"
        />
        <Kpi
          label="相似重复簇"
          value={`${kpi.dupClusters} 簇`}
          title="有 ≥75% 相似 active 词的 pending 词数"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-panel px-4 py-2.5">
        {SEGMENTS.map(([seg, label]) => (
          <Link
            key={seg}
            href={boardHref(seg, 1, source)}
            className={`rounded-sm px-3 py-1 text-xs ${
              seg === segment
                ? "bg-accent-dim font-semibold text-accent"
                : "bg-panel-2 text-text-2 hover:text-text-1"
            }`}
          >
            {label} {board.counts[seg]}
          </Link>
        ))}
        <form
          method="GET"
          action="/admin/insight/discovery/"
          className="ml-auto flex items-center gap-1.5"
        >
          <input type="hidden" name="t" value="candidates" />
          {segment !== "pending" && <input type="hidden" name="status" value={segment} />}
          <label className="text-[11px] text-text-3" htmlFor="cw-source">
            来源:
          </label>
          <select
            id="cw-source"
            name="source"
            defaultValue={source ?? ""}
            className="rounded-sm border border-line bg-panel px-1.5 py-1 text-xs text-text-2"
          >
            {WORD_CANDIDATE_SOURCES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="cursor-pointer rounded-sm border border-line bg-panel px-2.5 py-1 text-xs text-text-2 hover:border-line-hover hover:text-text-1"
          >
            筛选
          </button>
        </form>
      </div>

      {segment === "pending" && (
        <p className="text-[11px] text-text-3">
          相似度 ≥75% 提示合并;合并 = 作为已有词的别名,不新建词条
        </p>
      )}

      <div className="overflow-hidden rounded-md border border-line bg-panel">
        {board.cards.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs text-text-3">
            {segment === "pending"
              ? "暂无待审候选——跑一轮发现(源管理 · 台账行内)后新词落此"
              : "该分段暂无词"}
          </p>
        ) : (
          board.cards.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-3 last:border-b-0 hover:bg-panel-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-text-1" title={c.word}>
                  {c.word}
                </div>
                <div className="mt-0.5 text-[11px] text-text-3">
                  {c.originLabel} · {relDay(c.createdAt)} · 信号 {c.signalCount}
                </div>
                {/* 相似提示与终审动作只属待审流:其余段卡词本身在 active 池,会自我匹配 */}
                {segment === "pending" && c.similar !== null && (
                  <div className="mt-1 text-[11px] text-amber-hi" title="点击「合并」并入该词">
                    与「{c.similar.word}」相似 {c.similar.pct}%
                  </div>
                )}
              </div>
              {segment === "pending" && (
                <CandidateWordActions id={c.id} word={c.word} similar={c.similar} />
              )}
            </div>
          ))
        )}
        <AdminPagination
          page={board.page}
          totalPages={totalPages}
          total={board.total}
          hrefFor={(p) => boardHref(segment, p, source)}
          unit="词"
        />
      </div>

      <p className="text-[11px] text-text-3">
        待审 {kpi.pending} · 本页 {board.cards.length} 条 · 终审后计入采纳率,拒绝词 30
        天内不重复产出
      </p>
    </div>
  );
}
