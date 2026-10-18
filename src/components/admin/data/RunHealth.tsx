/**
 * 运行·健康页签(验收二批③):job_run 按 job_key 聚合——24h/7d 成功率、
 * 平均耗时、最近成败、连败、挂起疑似,一行一任务一条结论。无健康快照表
 * (量级用不上):判定全部 SQL 聚合 + 纯函数,即查即得,读侧口径改动不涉及
 * 数据回填。
 */
import { jobRunHealth, jobRunLabel, JOB_RUN_HUNG_AFTER_MS } from "@/lib/jobs/runlog-admin";
import { requireAdminPage } from "@/lib/auth/guard";
import type { JobKeyHealth } from "@/lib/jobs/runlog-admin";

import { fmtDuration, fmtTime } from "./run-format";

type Tone = "red" | "amber" | "blue" | "green";

const TONE_CLS: Record<Tone, string> = {
  red: "bg-red/12 text-red",
  amber: "bg-amber/12 text-amber-hi",
  blue: "bg-blue/12 text-blue",
  green: "bg-green/12 text-green",
};

/** 一行结论(判定优先级:连败 > 挂起 > 成功率低 > 7 日无成功 > 进行中 > 正常) */
function verdict(k: JobKeyHealth, hungCount: number, streak: number): { text: string; tone: Tone } {
  if (streak >= 2) return { text: `连败 ${streak}`, tone: "red" };
  if (hungCount > 0) return { text: `挂起 ${hungCount}`, tone: "red" };
  if (streak === 1) return { text: "上次失败", tone: "amber" };
  if (k.total24h >= 3 && k.success24h / k.total24h < 0.8) {
    return { text: `成功率 ${Math.round((k.success24h / k.total24h) * 100)}%`, tone: "amber" };
  }
  if (k.total7d > 0 && k.lastSuccessAt === null) return { text: "7 日无成功", tone: "amber" };
  if (k.runningNow > 0) return { text: `进行中 ${k.runningNow}`, tone: "blue" };
  return { text: "正常", tone: "green" };
}

function pct(part: number, total: number): string {
  return total === 0 ? "—" : `${Math.round((part / total) * 100)}%`;
}

export default async function RunHealth(): Promise<React.ReactElement> {
  await requireAdminPage();
  const { keys, hung, streaks } = await jobRunHealth();

  const hungByKey = new Map<string, number>();
  for (const h of hung) hungByKey.set(h.jobKey, (hungByKey.get(h.jobKey) ?? 0) + 1);

  // 有问题的排前面:红结论 > 琥珀 > 蓝/绿,同档按任务键
  const rank = (k: JobKeyHealth): number => {
    const t = verdict(k, hungByKey.get(k.jobKey) ?? 0, streaks[k.jobKey] ?? 0).tone;
    return t === "red" ? 0 : t === "amber" ? 1 : 2;
  };
  const sorted = [...keys].sort((a, b) => rank(a) - rank(b) || a.jobKey.localeCompare(b.jobKey));

  return (
    <div className="flex flex-col gap-3">
      {hung.length > 0 && (
        <div className="rounded-md border border-red/40 bg-red/10 px-4 py-3 text-xs text-red">
          {hung.length} 个任务疑似挂死(running 超 {Math.round(JOB_RUN_HUNG_AFTER_MS / 60_000)}
          分钟未落终态):
          {hung
            .slice(0, 5)
            .map((h) => `${jobRunLabel(h.jobKey)}(${fmtTime(h.startedAt)} 起)`)
            .join("、")}
          {hung.length > 5 && " 等"}——查 worker 日志定位,进程崩溃残留会在日清批(04:47)代标失败。
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-[11px] text-text-3">
              <th className="px-4 py-2 font-normal">任务</th>
              <th className="px-3 py-2 text-right font-normal">24h</th>
              <th className="px-3 py-2 text-right font-normal">7 日失败</th>
              <th className="px-3 py-2 text-right font-normal">平均耗时</th>
              <th className="px-3 py-2 font-normal">最近成功</th>
              <th className="px-3 py-2 font-normal">最近失败</th>
              <th className="px-4 py-2 text-right font-normal">结论</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((k) => {
              const v = verdict(k, hungByKey.get(k.jobKey) ?? 0, streaks[k.jobKey] ?? 0);
              return (
                <tr
                  key={k.jobKey}
                  className="border-b border-line last:border-b-0 hover:bg-panel-2"
                >
                  <td className="px-4 py-2 align-top">
                    <div className="text-text-1">{jobRunLabel(k.jobKey)}</div>
                    <div className="font-mono text-[10px] text-text-3">{k.jobKey}</div>
                  </td>
                  <td className="px-3 py-2 text-right align-top font-mono text-[11px] text-text-2">
                    {k.total24h === 0
                      ? "—"
                      : `${k.success24h}/${k.total24h} · ${pct(k.success24h, k.total24h)}`}
                  </td>
                  <td className="px-3 py-2 text-right align-top font-mono text-[11px]">
                    {k.fail7d > 0 ? (
                      <span className="text-red">
                        {k.fail7d}/{k.total7d}
                      </span>
                    ) : (
                      <span className="text-text-3">0/{k.total7d}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right align-top font-mono text-[11px] text-text-2">
                    {fmtDuration(k.avgDurationMs === null ? null : Math.round(k.avgDurationMs))}
                  </td>
                  <td className="w-24 px-3 py-2 align-top font-mono text-[11px] text-text-3">
                    {k.lastSuccessAt === null ? "—" : fmtTime(k.lastSuccessAt)}
                  </td>
                  <td className="w-24 px-3 py-2 align-top font-mono text-[11px] text-text-3">
                    {k.lastFailedAt === null ? "—" : fmtTime(k.lastFailedAt)}
                  </td>
                  <td className="px-4 py-2 text-right align-top">
                    <span
                      className={`rounded-sm px-1.5 py-0.5 text-[11px] whitespace-nowrap ${TONE_CLS[v.tone]}`}
                    >
                      {v.text}
                    </span>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-xs text-text-3">
                  暂无台账记录:落账任务跑过一轮后这里即有健康结论(热榜拉取每小时一轮,最快 1
                  小时内出数)。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-text-3">
        结论口径:连败 ≥2 标红(同一任务连续两轮失败基本是配置/外部依赖问题);挂起 = running 超 1
        小时(批任务分钟级,超时基本是执行体挂死);24h 成功率 &lt;80%(≥3 轮)标琥珀。 tick
        心跳类任务不入账,不在此列。
      </p>
    </div>
  );
}
