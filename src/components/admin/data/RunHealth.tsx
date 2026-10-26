/**
 * 运行·健康页签(F19 板):统一口径「连败 ≥2 红 · 24h 成功率 <80% 琥珀 ·
 * 7 日无成功 · 静默超时(挂起 = running 超 1h)」。metric 5 卡(健康分/
 * 进行中故障/降级观察/脱期/24h 成功率)+ 表按域分组(文字渠道/视频平台/
 * 发现任务/分析·维护)。渠道行无逐渠道运行计数与错误字段 → 成功率/归因
 * 显「—」不造假;jobRun 行归因 = 末次失败 error。
 */
import Link from "next/link";

import LiveRefresher from "@/components/admin/data/LiveRefresher";
import { requireAdminPage } from "@/lib/auth/guard";
import { channelHealthRows } from "@/lib/collect/channel-health";
import { registryIntervalMs, registryJobRunKeys } from "@/lib/collect/plan-rows";
import { jobRunHealth, jobRunLabel } from "@/lib/jobs/runlog-admin";
import type { JobKeyHealth } from "@/lib/jobs/runlog-admin";
import { healthOf } from "@/lib/collect/channel-ledger-types";

import { fmtTime } from "./run-format";

type Tone = "red" | "amber" | "blue" | "green" | "gray";

const TONE_CLS: Record<Tone, string> = {
  red: "bg-red/12 text-red",
  amber: "bg-amber/12 text-amber-hi",
  blue: "bg-blue/12 text-blue",
  green: "bg-green/12 text-green",
  gray: "bg-panel-2 text-text-3",
};

interface HealthRow {
  key: string;
  name: string;
  sub: string | null;
  tone: Tone;
  text: string;
  rate: string;
  fails: number | null;
  cause: string | null;
  lastOk: Date | null;
  running: boolean;
  logsHref: string;
}

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

function Metric({
  value,
  label,
  sub,
  tone = "text-text-1",
  title,
}: {
  value: string;
  label: string;
  sub?: string;
  tone?: string;
  title?: string;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-panel px-4 py-3" title={title}>
      <div className={`font-mono text-[22px] font-bold leading-none ${tone}`}>{value}</div>
      <div className="mt-1.5 text-[11px] text-text-2">{label}</div>
      {sub !== undefined && <div className="mt-0.5 text-[10px] text-text-3">{sub}</div>}
    </div>
  );
}

function GroupTable({ title, rows }: { title: string; rows: HealthRow[] }): React.ReactElement {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-panel">
      <div className="border-b border-line bg-panel-2 px-4 py-2 text-xs font-semibold text-text-2">
        {title}
      </div>
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line text-[11px] text-text-3">
            <th className="px-4 py-2 font-normal">渠道 / 任务</th>
            <th className="px-3 py-2 font-normal">状态</th>
            <th className="px-3 py-2 text-right font-normal">24h 成功率</th>
            <th className="px-3 py-2 text-right font-normal">连败</th>
            <th className="px-3 py-2 font-normal">归因</th>
            <th className="px-3 py-2 font-normal">最近成功</th>
            <th className="px-4 py-2 text-right font-normal">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line last:border-b-0 hover:bg-panel-2">
              <td className="px-4 py-2 align-top">
                <div className="text-text-1">{r.name}</div>
                {r.sub !== null && <div className="font-mono text-[10px] text-text-3">{r.sub}</div>}
              </td>
              <td className="px-3 py-2 align-top">
                <span
                  className={`rounded-sm px-1.5 py-0.5 text-[11px] whitespace-nowrap ${TONE_CLS[r.tone]}`}
                >
                  {r.text}
                </span>
              </td>
              <td className="px-3 py-2 text-right align-top font-mono text-[11px] text-text-2">
                {r.rate}
              </td>
              <td className="px-3 py-2 text-right align-top font-mono text-[11px]">
                {r.fails === null ? (
                  <span className="text-text-3">—</span>
                ) : r.fails > 0 ? (
                  <span className="text-red">{r.fails}</span>
                ) : (
                  <span className="text-text-3">0</span>
                )}
              </td>
              <td className="max-w-[260px] px-3 py-2 align-top">
                {r.cause === null ? (
                  <span className="text-text-3">—</span>
                ) : (
                  <span className="line-clamp-1 text-red" title={r.cause}>
                    {r.cause}
                  </span>
                )}
              </td>
              <td className="w-24 px-3 py-2 align-top font-mono text-[11px] text-text-3">
                {r.lastOk === null ? "—" : fmtTime(r.lastOk)}
              </td>
              <td className="px-4 py-2 text-right align-top whitespace-nowrap text-[11px]">
                <Link href={r.logsHref} className="text-accent hover:text-accent-hover">
                  日志
                </Link>
                {r.running && (
                  <>
                    {" · "}
                    <Link
                      href="/admin/data/run/?t=overview"
                      className="text-text-2 hover:text-accent"
                    >
                      实时
                    </Link>
                  </>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-4 text-center text-xs text-text-3">
                暂无实例
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function RunHealth(): Promise<React.ReactElement> {
  await requireAdminPage();
  const [health, channelRows] = await Promise.all([jobRunHealth(), channelHealthRows()]);
  const { keys, hung, streaks } = health;

  const hungByKey = new Map<string, number>();
  for (const h of hung) hungByKey.set(h.jobKey, (hungByKey.get(h.jobKey) ?? 0) + 1);

  // 渠道行(文字/视频):无逐渠道运行计数 → 成功率/归因「—」;最近成功列落末次运行
  const chRows: HealthRow[] = channelRows.map((c) => {
    const h = healthOf(c.enabled, c.fails, c.status);
    return {
      key: c.key,
      name: c.name,
      sub: null,
      tone:
        h.health === "fail"
          ? "red"
          : h.health === "degraded"
            ? "amber"
            : h.health === "paused"
              ? "gray"
              : "green",
      text: h.healthText,
      rate: "—",
      fails: c.fails,
      cause: null,
      lastOk: c.lastRunAt,
      running: false,
      logsHref: "/admin/data/run/?t=jobs",
    };
  });

  // jobRun 行:连败/挂起/成功率判定 + 末次失败归因
  const lastRunByKey = new Map<string, Date | null>();
  const jobRows: HealthRow[] = keys.map((k) => {
    const v = verdict(k, hungByKey.get(k.jobKey) ?? 0, streaks[k.jobKey] ?? 0);
    lastRunByKey.set(
      k.jobKey,
      [k.lastSuccessAt, k.lastFailedAt].reduce<Date | null>(
        (acc, d) => (d !== null && (acc === null || d > acc) ? d : acc),
        null,
      ),
    );
    return {
      key: k.jobKey,
      name: jobRunLabel(k.jobKey),
      sub: k.jobKey,
      tone: v.tone,
      text: v.text,
      rate:
        k.total24h === 0
          ? "—"
          : `${Math.round((k.success24h / k.total24h) * 100)}% (${k.success24h}/${k.total24h})`,
      fails: streaks[k.jobKey] ?? 0,
      cause: k.lastError,
      lastOk: k.lastSuccessAt,
      running: k.runningNow > 0,
      logsHref: `/admin/data/run/?t=jobs&key=${encodeURIComponent(k.jobKey)}`,
    };
  });

  // metric:健康分 = 100 − 红×15 − 琥珀×5(挂起计入红,暂停不计),阈值 80
  const all = [...chRows, ...jobRows];
  const red = all.filter((r) => r.tone === "red").length;
  const amber = all.filter((r) => r.tone === "amber").length;
  const score = Math.max(0, 100 - red * 15 - amber * 5);
  const total24h = keys.reduce((acc, k) => acc + k.total24h, 0);
  const success24h = keys.reduce((acc, k) => acc + k.success24h, 0);
  const overdue = registryJobRunKeys().filter((jk) => {
    const iv = registryIntervalMs(jk);
    if (iv === null) return false;
    const last = lastRunByKey.get(jk) ?? null;
    return last === null || Date.now() - last.getTime() > 2 * iv;
  }).length;

  const byGroup = (prefix: string): HealthRow[] => jobRows.filter((r) => r.key.startsWith(prefix));
  const rest = jobRows.filter((r) => !r.key.startsWith("discovery/"));
  const discovery = byGroup("discovery/");
  const chBy = (g: "rss" | "video"): HealthRow[] =>
    chRows.filter((r) => r.key.startsWith(g === "rss" ? "rss-" : "video-"));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <LiveRefresher running={jobRows.filter((r) => r.running).length} actionLabel="立即检测" />
      </div>

      {hung.length > 0 && (
        <div className="rounded-md border border-red/40 bg-red/10 px-4 py-3 text-xs text-red">
          {hung.length} 个任务疑似挂死(running 超 60 分钟未落终态):
          {hung
            .slice(0, 5)
            .map((h) => `${jobRunLabel(h.jobKey)}(${fmtTime(h.startedAt)} 起)`)
            .join("、")}
          {hung.length > 5 && " 等"}——查 worker 日志定位,进程崩溃残留会在日清批(04:47)代标失败。
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Metric
          value={String(score)}
          label="整体健康分"
          sub="阈值 80 · 红 −15 琥珀 −5"
          tone={score >= 80 ? "text-green" : "text-amber-hi"}
          title="口径:100 − 故障行×15 − 降级行×5,下限 0;渠道行与任务行同权,暂停行不计"
        />
        <Metric
          value={String(red)}
          label="进行中故障"
          sub="连败 ≥2 或挂起"
          tone={red > 0 ? "text-red" : "text-text-1"}
        />
        <Metric
          value={String(amber)}
          label="降级观察"
          sub="上次失败 / 限频"
          tone={amber > 0 ? "text-amber-hi" : "text-text-1"}
        />
        <Metric
          value={String(overdue)}
          label="脱期任务"
          sub="超 2× 间隔未跑"
          tone={overdue > 0 ? "text-amber-hi" : "text-text-1"}
        />
        <Metric
          value={total24h === 0 ? "—" : `${Math.round((success24h / total24h) * 100)}%`}
          label="24h 成功率"
          sub={total24h === 0 ? "近 24h 无运行" : `${success24h}/${total24h} 轮`}
        />
      </div>

      <GroupTable title={`文字渠道 · ${chBy("rss").length} 实例`} rows={chBy("rss")} />
      <GroupTable title={`视频平台 · ${chBy("video").length} 实例`} rows={chBy("video")} />
      <GroupTable title={`发现任务 · ${discovery.length}`} rows={discovery} />
      <GroupTable title={`分析 / 维护 · ${rest.length}`} rows={rest} />

      <p className="text-[11px] text-text-3">
        渠道行的成功率与归因显「—」:渠道执行走 crawler 队列,不落 job_run,亦无逐渠道错误字段;
        「最近成功」列对渠道行实为末次运行时刻。tick 心跳类任务不入账,不在此列。
      </p>
    </div>
  );
}
