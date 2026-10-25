/**
 * F20 引擎卡:当前采集实况——活跃 job 逐条(● pulse + 已运行 mm:ss + job 起点上
 * 入库计数与队列剩余),无活跃 job 呈「引擎空闲 · 末次运行」。下挂「即将运行 ·
 * 未来 12 小时」与「最近运行」3 条(job_run 台账投影)。
 */
import Link from "next/link";

import { crawlerActiveRuns } from "@/lib/collect/crawler-runs";
import { upcomingRuns } from "@/lib/collect/plan-rows";
import { formatCnTime } from "@/lib/datetime";
import { prisma } from "@/lib/db";
import { jobRunLabel, listJobRuns } from "@/lib/jobs/runlog-admin";
import { getCrawlerQueueSnapshot } from "@/lib/telegram/spider-queries";

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default async function EngineCard(): Promise<React.ReactElement> {
  const [active, snapshot, upcoming, recent] = await Promise.all([
    crawlerActiveRuns(),
    getCrawlerQueueSnapshot(),
    upcomingRuns(12, 4),
    listJobRuns({ page: 1 }),
  ]);
  const since = active.length > 0 ? Math.min(...active.map((a) => a.sinceMs)) : null;
  const inserted =
    since === null
      ? 0
      : await prisma.telegram.count({ where: { createdAt: { gte: new Date(since) } } });

  return (
    <div className="flex flex-col rounded-md border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-3 text-sm font-semibold">
        <span className="flex items-center gap-2">
          采集引擎
          {active.length > 0 && (
            <i
              className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber"
              aria-label="运行中"
            />
          )}
        </span>
        <Link
          href="/admin/data/run/?t=jobs"
          className="font-mono text-[11px] font-normal text-text-3 hover:text-accent"
        >
          执行流水 →
        </Link>
      </div>

      <div className="px-4 py-3.5">
        {active.length > 0 ? (
          <div className="space-y-2.5">
            {active.slice(0, 4).map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-[13px]">
                <i className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber" />
                <span className="truncate text-text-1" title={a.label}>
                  {a.label}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-text-3">
                  已运行 {elapsed(a.sinceMs)}
                </span>
              </div>
            ))}
            <div className="text-[11px] text-text-3">
              进行中 {active.length} 个 job · 已入库{" "}
              <b className="font-medium text-text-1">{inserted}</b> 条 · 队列剩{" "}
              <b className="font-medium text-text-1">{snapshot.counts.waiting}</b>
            </div>
          </div>
        ) : (
          <div className="text-[13px] text-text-3">
            引擎空闲——渠道按间隔轮转,批次任务看「最近运行」;
            {snapshot.counts.waiting > 0
              ? `队列尚有 ${snapshot.counts.waiting} 条待消化`
              : "队列无积压"}
          </div>
        )}

        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-1.5 text-[11px] text-text-3">即将运行 · 未来 12 小时</div>
          {upcoming.length === 0 ? (
            <div className="text-xs text-text-3">12 小时内无定时触发</div>
          ) : (
            <div className="space-y-1">
              {upcoming.map((u) => (
                <div key={u.key} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-text-2">{u.atText}</span>
                  <span className="truncate text-text-3" title={u.label}>
                    {u.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3 border-t border-line pt-3">
          <div className="mb-1.5 text-[11px] text-text-3">最近运行</div>
          <div className="space-y-1">
            {recent.rows.slice(0, 3).map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-xs">
                <span
                  className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                    r.status === "success"
                      ? "bg-green"
                      : r.status === "failed"
                        ? "bg-red"
                        : "bg-blue animate-pulse"
                  }`}
                />
                <span className="truncate text-text-2" title={r.jobKey}>
                  {jobRunLabel(r.jobKey)}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[10.5px] text-text-3">
                  {formatCnTime(r.startedAt)}
                </span>
              </div>
            ))}
            {recent.rows.length === 0 && <div className="text-xs text-text-3">暂无落账运行</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
