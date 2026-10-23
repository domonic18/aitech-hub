/**
 * 运行·采集日志页签(F18 板):job_run 全量执行流水——批任务每轮一行
 * (worker/job-run 单一写入口落账,tick 心跳与请求驱动单元任务不入账)。
 * 状态计数 chips(成功/失败/运行中;jobRun 无「跳过」态不硬造)+ 今天|全部
 * 范围/状态/任务三筛选 + 6 列 任务|触发|状态|入库·耗时|时间|说明;运行中
 * 每 3 秒自动刷新(LiveRefresher)。服务端直查不设读 API。
 */
import Link from "next/link";

import LiveRefresher from "@/components/admin/data/LiveRefresher";
import { requireAdminPage } from "@/lib/auth/guard";
import {
  jobRunLabel,
  JOB_RUN_LABELS,
  jobRunStatusCounts,
  listJobRuns,
} from "@/lib/jobs/runlog-admin";

import { fmtDuration, fmtTime, summaryInserted } from "./run-format";

const KEY_RE = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const STATUSES = ["running", "success", "failed"] as const;
const STATUS_LABELS: Record<string, string> = {
  running: "运行中",
  success: "成功",
  failed: "失败",
};
const STATUS_CLS: Record<string, string> = {
  running: "bg-blue/12 text-blue",
  success: "bg-green/12 text-green",
  failed: "bg-red/12 text-red",
};

/** 摘要 JSON 单行截头(对象/标量统一 stringify;超长由 title 兜底) */
function summaryLine(summary: unknown): string | null {
  if (summary === null || summary === undefined) return null;
  const text = JSON.stringify(summary);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

interface Cur {
  key?: string;
  status?: string;
  today: boolean;
  page: number;
}

function buildHref(cur: Cur, overrides: Partial<Cur>): string {
  const merged = { ...cur, ...overrides };
  const sp = new URLSearchParams({ t: "jobs" });
  if (merged.key) sp.set("key", merged.key);
  if (merged.status) sp.set("status", merged.status);
  if (merged.today) sp.set("range", "today");
  if (merged.page > 1) sp.set("page", String(merged.page));
  return `/admin/data/run/?${sp.toString()}`;
}

const selectCls = "rounded-sm border border-line bg-panel px-1.5 py-0.5 text-[11px] text-text-2";

export default async function RunJobs({
  sp,
}: {
  sp: { key?: string; status?: string; range?: string; page?: string };
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const key = KEY_RE.test(sp.key ?? "") ? sp.key : undefined;
  const status = STATUSES.some((s) => s === sp.status) ? sp.status : undefined;
  const today = sp.range === "today";
  const page = Number.isInteger(Number(sp.page)) && Number(sp.page) > 0 ? Number(sp.page) : 1;
  const cur: Cur = { key, status, today, page };

  const [{ rows, total, pages }, counts] = await Promise.all([
    listJobRuns({ key, status, today, page }),
    jobRunStatusCounts({ key, today }),
  ]);

  return (
    <div className="flex flex-col gap-3">
      {/* 工具行:实时刷新指示 + 状态计数 chips + 范围/状态/任务筛选(F18) */}
      <div className="flex flex-wrap items-center gap-2">
        <LiveRefresher running={counts.running} />
        <span className="flex items-center gap-1.5">
          {STATUSES.map((s) => (
            <Link
              key={s}
              href={buildHref(cur, { status: status === s ? undefined : s, page: 1 })}
              className={`rounded-sm px-2 py-0.5 text-[11px] transition-colors ${
                status === s ? STATUS_CLS[s] : "bg-panel-2 text-text-3 hover:text-text-1"
              }`}
            >
              {STATUS_LABELS[s]} {counts[s]}
            </Link>
          ))}
        </span>
        <form method="GET" action="/admin/data/run/" className="ml-auto flex items-center gap-1.5">
          <input type="hidden" name="t" value="jobs" />
          <select
            name="range"
            defaultValue={today ? "today" : ""}
            aria-label="范围"
            className={selectCls}
          >
            <option value="">全部时间</option>
            <option value="today">今天</option>
          </select>
          <select name="key" defaultValue={key ?? ""} aria-label="任务" className={selectCls}>
            <option value="">全部任务</option>
            {Object.entries(JOB_RUN_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={status ?? ""} aria-label="状态" className={selectCls}>
            <option value="">全部状态</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="cursor-pointer rounded-sm border border-line bg-panel px-2 py-0.5 text-[11px] text-text-2 hover:border-line-hover hover:text-text-1"
          >
            筛选
          </button>
        </form>
        {(key || status || today) && (
          <Link
            href="/admin/data/run/?t=jobs"
            className="text-[11px] text-text-3 hover:text-accent"
          >
            清除
          </Link>
        )}
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-[11px] text-text-3">
              <th className="px-4 py-2 font-normal">任务</th>
              <th className="px-3 py-2 font-normal">触发</th>
              <th className="px-3 py-2 font-normal">状态</th>
              <th className="px-3 py-2 text-right font-normal">入库 · 耗时</th>
              <th className="px-3 py-2 font-normal">时间</th>
              <th className="px-4 py-2 font-normal">说明</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const inserted = summaryInserted(r.summary);
              return (
                <tr key={r.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                  <td className="px-4 py-2 align-top">
                    <div className="text-text-1">{jobRunLabel(r.jobKey)}</div>
                    <div className="font-mono text-[10px] text-text-3">{r.jobKey}</div>
                  </td>
                  <td className="w-12 px-3 py-2 align-top">
                    {r.trigger === "manual" ? (
                      <span className="rounded-sm bg-accent-dim px-1.5 py-0.5 font-mono text-[11px] text-accent">
                        手动
                      </span>
                    ) : (
                      <span className="text-[11px] text-text-3">排程</span>
                    )}
                  </td>
                  <td className="w-16 px-3 py-2 align-top">
                    <span
                      className={`rounded-sm px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap ${STATUS_CLS[r.status] ?? ""}`}
                    >
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="w-28 px-3 py-2 text-right align-top font-mono text-[11px] text-text-2">
                    {inserted !== null && (
                      <b className="mr-1 font-medium text-text-1">{inserted}</b>
                    )}
                    {fmtDuration(r.durationMs)}
                  </td>
                  <td className="w-28 px-3 py-2 align-top font-mono text-[11px] whitespace-nowrap text-text-3">
                    {fmtTime(r.startedAt)}
                  </td>
                  <td className="px-4 py-2 align-top">
                    {r.error !== null ? (
                      <span className="line-clamp-1 text-red" title={r.error}>
                        {r.error}
                      </span>
                    ) : (
                      <span
                        className="line-clamp-1 font-mono text-[11px] text-text-3"
                        title={summaryLine(r.summary) ?? undefined}
                      >
                        {summaryLine(r.summary)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-text-3">
                  {key || status || today
                    ? "该过滤条件下暂无记录,放宽条件或等下一轮任务"
                    : "暂无台账记录:落账任务(热榜拉取/日批/备份/清理等)跑过一轮后这里即有数据"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-text-3">
          共 {total} 条{today ? " · 今天" : ""}
        </span>
        {pages > 1 && (
          <span className="flex gap-3 text-[11px]">
            {page > 1 && (
              <Link
                href={buildHref(cur, { page: page - 1 })}
                className="text-text-2 hover:text-accent"
              >
                ‹ 上一页
              </Link>
            )}
            <span className="font-mono text-text-3">
              {page} / {pages}
            </span>
            {page < pages && (
              <Link
                href={buildHref(cur, { page: page + 1 })}
                className="text-text-2 hover:text-accent"
              >
                下一页 ›
              </Link>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
