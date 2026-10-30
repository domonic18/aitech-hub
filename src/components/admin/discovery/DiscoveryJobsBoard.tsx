/**
 * F10 发现任务页(discovery?t=jobs):两任务卡(热词发现/每日 05:37 · B站发现/
 * 每周一 06:13,节奏由 SCHEDULE_REGISTRY cron 推导)+ 最近发现任务运行表
 * (job_run 台账投影,6 列 任务|触发|状态|开始时间|耗时|摘要)。手动触发统一
 * 在 源管理·台账 行内(板 note;本页不放触发钮)。
 */
import Link from "next/link";

import { formatCnDateTime } from "@/lib/datetime";
import { latestJobRun } from "@/lib/jobs/runlog-admin";
import { jobRunLabel, listJobRuns } from "@/lib/jobs/runlog-admin";
import { cadenceLabel } from "@/lib/collect/plan-rows-types";
import { parseCron, SCHEDULE_REGISTRY, type CronParsed } from "@/lib/collect/schedules";
import type { JobRun } from "@prisma/client";

interface TaskDef {
  /** 登记表 key(F21 计划同源) */
  regKey: string;
  /** job_run jobKey */
  jobKey: string;
  name: string;
  desc: string;
  note: string;
}

const TASKS: TaskDef[] = [
  {
    regKey: "discovery-hotwords",
    jobKey: "discovery/discovery-hotwords",
    name: "热词发现",
    desc: "词库主动词联想直拉(bili/bing suggest),新词落 pending 待人工复核。",
    note: "手动触发统一在 源管理 · 台账 行内;进行中提示 409 不重复入队",
  },
  {
    regKey: "discovery-bili",
    jobKey: "discovery/discovery-bili",
    name: "B站发现",
    desc: "双窗口搜索(90 天博主聚合 + 7 天爆款视频)+ L0 元数据预筛,耗时数分钟。",
    note: "手动触发统一在 源管理 · 台账;结果进入 候选治理 终审",
  },
];

/** 登记表 cron → 节奏文案(与 F21 计划页同源推导,防硬编码漂移) */
function cadenceOf(regKey: string): string {
  const def = SCHEDULE_REGISTRY.find((d) => d.key === regKey);
  const parsed: CronParsed | null = def === undefined ? null : parseCron(def.cron);
  return parsed === null ? "—" : cadenceLabel(parsed);
}

/** 摘要列:失败显归因截断 / 运行中显进行中 / 成功按 outcome 形状直出 */
function summaryOf(run: JobRun): string {
  if (run.status === "running") return "进行中";
  if (run.status === "failed") return (run.error ?? "执行失败").slice(0, 60);
  const s = run.summary;
  if (s === null || typeof s !== "object") return "—";
  const o = s as Record<string, unknown>;
  const num = (k: string): number => (typeof o[k] === "number" ? (o[k] as number) : 0);
  if (run.jobKey.endsWith("hotwords")) {
    return `种子 ${num("seeds")} · 联想 ${num("suggestions")} · 新增 ${num("inserted")}`;
  }
  return `词 ${num("words")} · 候选 博主 ${num("bloggerCandidates")} · 视频 ${num("videoCandidates")}`;
}

function duration(ms: number | null): string {
  if (ms === null) return "—";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  success: { label: "成功", cls: "text-green", dot: "bg-green" },
  failed: { label: "失败", cls: "text-red", dot: "bg-red" },
  running: { label: "运行中", cls: "text-amber-hi", dot: "bg-amber animate-pulse" },
};

export default async function DiscoveryJobsBoard(): Promise<React.ReactElement> {
  const [hot, bili, hotRuns, biliRuns] = await Promise.all([
    latestJobRun(TASKS[0]!.jobKey),
    latestJobRun(TASKS[1]!.jobKey),
    listJobRuns({ key: TASKS[0]!.jobKey, page: 1 }),
    listJobRuns({ key: TASKS[1]!.jobKey, page: 1 }),
  ]);
  const lastRuns: Array<JobRun | null> = [hot, bili];
  const recent = [...hotRuns.rows, ...biliRuns.rows]
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, 8);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">发现任务</h2>
        <p className="mt-0.5 text-xs text-text-3">
          任务入队后由 worker 执行;结果见候选治理与 运行 › 日志
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {TASKS.map((t, i) => {
          const run: JobRun | null = lastRuns[i] ?? null;
          const meta = run === null ? null : (STATUS_META[run.status] ?? null);
          return (
            <div key={t.regKey} className="rounded-md border border-line bg-panel px-4 py-3.5">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold">{t.name}</span>
                <span className="font-mono text-[11px] text-text-3">{cadenceOf(t.regKey)}</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-text-2">{t.desc}</p>
              <div className="mt-2 text-xs">
                {run === null || meta === null ? (
                  <span className="text-text-3">上次运行:尚无落账</span>
                ) : (
                  <span className="text-text-2">
                    上次运行:
                    <span className="font-mono">{formatCnDateTime(run.startedAt)}</span> ·{" "}
                    <span className={`font-medium ${meta.cls}`}>{meta.label}</span>
                    {run.status !== "running" && (
                      <>
                        {" · "}
                        {summaryOf(run)}
                      </>
                    )}
                  </span>
                )}
              </div>
              <p className="mt-2 border-t border-line pt-2 text-[11px] text-text-3">{t.note}</p>
            </div>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <div className="flex items-baseline justify-between border-b border-line px-4 py-2.5">
          <span className="text-sm font-semibold">最近发现任务运行</span>
          <Link
            href="/admin/data/run/?t=jobs"
            className="text-[11px] text-text-3 hover:text-accent"
          >
            完整日志见 运行 · 采集日志 →
          </Link>
        </div>
        {/* min-w + 前五列 nowrap:窄屏(<640)表格会被压成「任/务」竖排单字,
            定最小宽后由外层 overflow-x-auto 横向滚动(2026-10-30 移动端验收) */}
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-xs whitespace-nowrap text-text-2">
              <th className="px-4 py-2.5 font-medium">任务</th>
              <th className="px-3 py-2.5 font-medium">触发</th>
              <th className="px-3 py-2.5 font-medium">状态</th>
              <th className="px-3 py-2.5 font-medium">开始时间</th>
              <th className="px-3 py-2.5 font-medium">耗时</th>
              <th className="px-4 py-2.5 font-medium">摘要</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => {
              const meta = STATUS_META[r.status] ?? STATUS_META.success!;
              return (
                <tr key={r.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                  <td className="px-4 py-2.5 whitespace-nowrap text-text-1" title={r.jobKey}>
                    {jobRunLabel(r.jobKey)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap text-text-2">
                    {r.trigger === "cron" ? "cron" : "手动"}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={`inline-flex items-center gap-1.5 text-xs ${meta.cls}`}>
                      <i className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap text-text-2">
                    {formatCnDateTime(r.startedAt).slice(5)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap text-text-2">
                    {duration(r.durationMs)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-text-2" title={r.error ?? undefined}>
                    {summaryOf(r)}
                  </td>
                </tr>
              );
            })}
            {recent.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs text-text-3">
                  暂无发现任务落账运行
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
