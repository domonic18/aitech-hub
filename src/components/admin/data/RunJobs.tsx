/**
 * 运行·任务日志页签(验收二批③):job_run 台账明细——周期/手动批任务每轮
 * 一行(worker/job-run 单一写入口落账,tick 心跳与请求驱动单元任务不入账)。
 * 任务/状态过滤 + 分页;错误/摘要截头,全文 title 悬浮。服务端直查不设读 API。
 */
import Link from "next/link";

import { jobRunLabel, JOB_RUN_LABELS, listJobRuns } from "@/lib/jobs/runlog-admin";
import { requireAdminPage } from "@/lib/auth/guard";

import { fmtDuration, fmtTime } from "./run-format";

const KEY_RE = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const STATUSES = ["running", "success", "failed"] as const;
const STATUS_LABELS: Record<string, string> = {
  running: "进行中",
  success: "成功",
  failed: "失败",
};

function StatusBadge({ status }: { status: string }): React.ReactElement {
  const tone =
    status === "success"
      ? "bg-green/12 text-green"
      : status === "failed"
        ? "bg-red/12 text-red"
        : "bg-blue/12 text-blue";
  return (
    <span className={`rounded-sm px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap ${tone}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

/** 摘要 JSON 单行截头(对象/标量统一 stringify;超长由 title 兜底) */
function summaryLine(summary: unknown): string | null {
  if (summary === null || summary === undefined) return null;
  const text = JSON.stringify(summary);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function buildHref(
  cur: { key?: string; status?: string; page?: number },
  overrides: Partial<{ key?: string; status?: string; page?: number }>,
): string {
  const merged = { ...cur, ...overrides };
  const sp = new URLSearchParams({ t: "jobs" });
  if (merged.key) sp.set("key", merged.key);
  if (merged.status) sp.set("status", merged.status);
  if (merged.page && merged.page > 1) sp.set("page", String(merged.page));
  return `/admin/data/run/?${sp.toString()}`;
}

const selectCls = "rounded-sm border border-line bg-panel px-1.5 py-0.5 text-[11px] text-text-2";

export default async function RunJobs({
  sp,
}: {
  sp: { key?: string; status?: string; page?: string };
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const key = KEY_RE.test(sp.key ?? "") ? sp.key : undefined;
  const status = STATUSES.some((s) => s === sp.status) ? sp.status : undefined;
  const page = Number.isInteger(Number(sp.page)) && Number(sp.page) > 0 ? Number(sp.page) : 1;
  const cur = { key, status, page };

  const { rows, total, pages } = await listJobRuns({ key, status, page });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <form method="GET" action="/admin/data/run/" className="flex items-center gap-1.5">
          <input type="hidden" name="t" value="jobs" />
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
        {(key || status) && (
          <Link
            href="/admin/data/run/?t=jobs"
            className="text-[11px] text-text-3 hover:text-accent"
          >
            清除
          </Link>
        )}
        <span className="ml-auto font-mono text-[11px] text-text-3">共 {total} 条</span>
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-[11px] text-text-3">
              <th className="px-4 py-2 font-normal">时间</th>
              <th className="px-3 py-2 font-normal">任务</th>
              <th className="px-3 py-2 font-normal">触发</th>
              <th className="px-3 py-2 font-normal">状态</th>
              <th className="px-3 py-2 text-right font-normal">耗时</th>
              <th className="px-4 py-2 font-normal">摘要 / 错误</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                <td className="w-28 px-4 py-2 align-top font-mono text-[11px] whitespace-nowrap text-text-3">
                  {fmtTime(r.startedAt)}
                </td>
                <td className="px-3 py-2 align-top">
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
                  <StatusBadge status={r.status} />
                </td>
                <td className="w-16 px-3 py-2 text-right align-top font-mono text-[11px] text-text-2">
                  {fmtDuration(r.durationMs)}
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
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-text-3">
                  {key || status
                    ? "该过滤条件下暂无记录,放宽条件或等下一轮任务"
                    : "暂无台账记录:落账任务(热榜拉取/日批/备份/清理等)跑过一轮后这里即有数据"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] text-text-3">
            第 {page} / {pages} 页
          </span>
          <span className="flex gap-3 text-[11px]">
            {page > 1 && (
              <Link
                href={buildHref(cur, { page: page - 1 })}
                className="text-text-2 hover:text-accent"
              >
                ‹ 上一页
              </Link>
            )}
            {page < pages && (
              <Link
                href={buildHref(cur, { page: page + 1 })}
                className="text-text-2 hover:text-accent"
              >
                下一页 ›
              </Link>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
