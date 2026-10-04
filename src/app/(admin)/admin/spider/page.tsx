/**
 * 采集总览页(M7 批④c;2026-10-04 按原型 admin-spider 重排):4 KPI 卡 +
 * 队列堆叠条/24h 入库条带(mid-grid 1fr 360px)+ 采集日历热力图 + 最近错误行。
 * 纯只读 RSC;渠道健康明细在台账页(/admin/channels),治理动作在电报流治理页。
 */
import Link from "next/link";

import { requireAdminPage } from "@/lib/auth/guard";
import { formatCnTime } from "@/lib/datetime";
import { listChannelsAdmin } from "@/lib/telegram/channels-admin";
import {
  getCrawlerQueueSnapshot,
  getInterpreterQueueSnapshot,
  getIngestCalendar,
  getIngestHourly,
  getTelegramStock,
  getVideoObservation,
} from "@/lib/telegram/spider-queries";

export const dynamic = "force-dynamic";

/** 原型 heat-grid 四档色:0 槽色,其余 accent 按 30/60/100% 调入 */
const HEAT_COLORS = [
  "var(--panel-2)",
  "color-mix(in srgb, var(--accent) 30%, var(--panel-2))",
  "color-mix(in srgb, var(--accent) 60%, var(--panel-2))",
  "var(--accent)",
];

function heatStyle(count: number, max: number): React.CSSProperties {
  const level = count <= 0 ? 0 : Math.min(3, Math.ceil((count / Math.max(max, 1)) * 3));
  return { background: HEAT_COLORS[level]! };
}

/** 空值展示「—」的 HH:mm(formatCnTime 同口径) */
function hhmm(at: Date | null): string {
  return at === null ? "—" : formatCnTime(at);
}

export default async function AdminSpiderPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const [snapshot, calendar, hourly, stock, channels, video, interpreter] = await Promise.all([
    getCrawlerQueueSnapshot(),
    getIngestCalendar(14),
    getIngestHourly(),
    getTelegramStock(),
    listChannelsAdmin(),
    getVideoObservation(),
    getInterpreterQueueSnapshot(),
  ]);
  const today = calendar[calendar.length - 1]?.count ?? 0;
  const yesterday = calendar[calendar.length - 2]?.count ?? 0;
  const maxDay = Math.max(1, ...calendar.map((c) => c.count));
  const maxHour = Math.max(1, ...hourly.map((h) => h.count));
  const stockTotal = Object.values(stock).reduce((a, b) => a + b, 0);
  const enabledChannels = channels.filter((c) => c.enabled).length;
  const backlog = snapshot.counts.waiting + snapshot.counts.delayed;
  const busyTotal = Math.max(1, backlog + snapshot.counts.active + snapshot.counts.failed);
  const interpreterBacklog = interpreter.counts.waiting + interpreter.counts.delayed;
  const interpreterBusyTotal = Math.max(
    1,
    interpreterBacklog + interpreter.counts.active + interpreter.counts.failed,
  );

  const kpi = "rounded-md border border-line bg-panel px-4 py-4";
  const kpiLabel = "flex items-center gap-1.5 text-[12.5px] text-text-2";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">采集总览</h2>
        <p className="mt-0.5 text-xs text-text-3">
          worker 运行态与采集实况;渠道健康度明细见
          <Link href="/admin/channels/" className="mx-1 text-accent hover:text-accent-hover">
            渠道台账
          </Link>
          ,治理动作见电报流治理页。
        </p>
      </div>

      {/* KPI ×4(原型 kpi-grid) */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className={kpi}>
          <div className={kpiLabel}>
            <svg className="ic text-accent" aria-hidden="true">
              <use href="#i-send" />
            </svg>
            今日入库
          </div>
          <div className="mt-2 font-mono text-[26px] font-bold leading-none tracking-[-0.01em] text-text-1">
            {today}
          </div>
          <div className="mt-1.5 text-[11.5px] text-text-3">
            较昨日
            <b className={`ml-1 font-medium ${today >= yesterday ? "text-green" : "text-amber"}`}>
              {today >= yesterday ? "+" : ""}
              {today - yesterday}
            </b>
          </div>
        </div>
        <div className={kpi}>
          <div className={kpiLabel}>
            <svg className="ic text-accent" aria-hidden="true">
              <use href="#i-cloudserver" />
            </svg>
            条目库存
          </div>
          <div className="mt-2 font-mono text-[26px] font-bold leading-none tracking-[-0.01em] text-text-1">
            {stockTotal}
          </div>
          <div className="mt-1.5 text-[11.5px] text-text-3">
            可见 <b className="font-medium text-green">{stock.visible ?? 0}</b> · 隐藏{" "}
            <b className="font-medium text-text-2">{stock.hidden ?? 0}</b> · 归档{" "}
            <b className="font-medium text-text-2">{stock.archived ?? 0}</b>
          </div>
        </div>
        <div className={kpi}>
          <div className={kpiLabel}>
            <svg className="ic text-accent" aria-hidden="true">
              <use href="#i-dashboard" />
            </svg>
            队列积压
          </div>
          <div className="mt-2 font-mono text-[26px] font-bold leading-none tracking-[-0.01em] text-text-1">
            {backlog}
          </div>
          <div className="mt-1.5 text-[11.5px] text-text-3">
            active <b className="font-medium text-text-2">{snapshot.counts.active}</b> · completed{" "}
            <b className="font-medium text-text-2">{snapshot.counts.completed}</b>
          </div>
        </div>
        <div className={kpi}>
          <div className={kpiLabel}>
            <svg className="ic text-accent" aria-hidden="true">
              <use href="#i-warning" />
            </svg>
            失败任务
          </div>
          <div
            className={`mt-2 font-mono text-[26px] font-bold leading-none tracking-[-0.01em] ${
              snapshot.counts.failed > 0 ? "text-red" : "text-text-1"
            }`}
          >
            {snapshot.counts.failed}
          </div>
          <div className="mt-1.5 text-[11.5px] text-text-3">
            渠道 <b className="font-medium text-text-2">{enabledChannels}</b> 个调度中
          </div>
        </div>
      </div>

      {/* 短视频观测细带(M8;博主明细与 Cookie 池在 /admin/bloggers) */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border border-line bg-panel px-4 py-3 text-xs text-text-3">
        <span className="font-semibold text-text-2">短视频</span>
        <span>
          博主 <b className="font-medium text-text-2">{video.bloggerCount}</b>(调度中{" "}
          <b className="font-medium text-text-2">{video.enabledCount}</b>)
        </span>
        <span>
          24h 入库{" "}
          <b className={`font-medium ${video.videoCount24h > 0 ? "text-green" : "text-text-2"}`}>
            {video.videoCount24h}
          </b>{" "}
          条
        </span>
        <span>最新 {video.lastVideoAt ? hhmm(video.lastVideoAt) : "—"}</span>
        <Link href="/admin/bloggers/" className="ml-auto text-accent hover:text-accent-hover">
          博主台账 →
        </Link>
      </div>

      {/* 双队列实况 + 24h 条带(原型 mid-grid 1fr 360px;M9 起 interpreter 真实计数) */}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rounded-md border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3.5 text-sm font-semibold">
            双队列实况
            <span className="font-mono text-[11px] font-normal text-text-3">BullMQ</span>
          </div>
          <div className="px-4 py-4">
            {/* crawler:文字渠道 + 视频博主同队列调度(arch/02 §3.2 注记) */}
            <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-text-1">
              <svg className="ic text-accent" aria-hidden="true">
                <use href="#i-cloudserver" />
              </svg>
              <span>crawler</span>
              <span className="text-[11px] font-normal text-text-3">
                文字 + 视频抓取 · {enabledChannels} 渠道 + {video.enabledCount} 博主
              </span>
              <span className="ml-auto font-mono text-[11px] font-normal text-text-3">
                active <b>{snapshot.counts.active}</b> · waiting <b>{backlog}</b> · completed{" "}
                <b>{snapshot.counts.completed}</b> · failed <b>{snapshot.counts.failed}</b>
              </span>
            </div>
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-[5px] bg-panel-2">
              <span
                className="block h-full bg-accent"
                style={{ width: `${(snapshot.counts.active / busyTotal) * 100}%` }}
              />
              <span
                className="block h-full bg-accent/45"
                style={{ width: `${(backlog / busyTotal) * 100}%` }}
              />
              <span className="block h-full flex-1" />
              <span
                className="block h-full bg-red"
                style={{ width: `${(snapshot.counts.failed / busyTotal) * 100}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-4 font-mono text-[11px] text-text-3">
              <span>
                <i className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-accent" />
                active
              </span>
              <span>
                <i className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-accent/45" />
                waiting
              </span>
              <span>
                <i className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-panel-2" />
                completed(近 200 留存)
              </span>
              <span>
                <i className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-red" />
                failed
              </span>
              <span className="text-text-3/80">视频博主 crawl-video 与文字渠道同队列调度</span>
            </div>

            {/* interpreter(M9 实况):下载/抽轨/ASR/LLM,并发 1(ffmpeg CPU 峰值) */}
            <div className="mt-4 border-t border-line pt-4">
              <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-text-1">
                <svg
                  className={`ic ${interpreter.counts.active > 0 ? "text-accent" : "text-text-3"}`}
                  aria-hidden="true"
                >
                  <use href="#i-robot" />
                </svg>
                <span>interpreter</span>
                <span className="text-[11px] font-normal text-text-3">
                  视频解读 · 下载 / 抽轨 / ASR / LLM · 并发 1 · 今日 {interpreter.todayDone}/
                  {interpreter.dailyMax}
                </span>
                <span className="ml-auto font-mono text-[11px] font-normal text-text-3">
                  active <b>{interpreter.counts.active}</b> · waiting{" "}
                  <b>{interpreter.counts.waiting + interpreter.counts.delayed}</b> · completed{" "}
                  <b>{interpreter.counts.completed}</b> · failed <b>{interpreter.counts.failed}</b>
                </span>
              </div>
              <div className="mt-2 flex h-2.5 overflow-hidden rounded-[5px] bg-panel-2">
                <span
                  className="block h-full bg-accent"
                  style={{
                    width: `${(interpreter.counts.active / interpreterBusyTotal) * 100}%`,
                  }}
                />
                <span
                  className="block h-full bg-accent/45"
                  style={{
                    width: `${((interpreter.counts.waiting + interpreter.counts.delayed) / interpreterBusyTotal) * 100}%`,
                  }}
                />
                <span className="block h-full flex-1" />
                <span
                  className="block h-full bg-red"
                  style={{
                    width: `${(interpreter.counts.failed / interpreterBusyTotal) * 100}%`,
                  }}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px] text-text-3">
                <span>
                  <i className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-panel-2" />
                  completed(近 50 留存)
                </span>
                <span>日配额超限延迟 30min 重投(delayed),失败条目经治理台「解读」按钮重试</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line px-4 py-3 font-mono text-xs text-text-3">
            <span>
              <span>tick 调度器</span>
              {snapshot.tickAlive ? (
                <b className="ml-1.5 font-medium text-green">存活</b>
              ) : (
                <b className="ml-1.5 font-medium text-amber">未注册(worker 未启动?)</b>
              )}
            </span>
            <span>每分钟扫描到期渠道,crawl job 以 nextRunAt 幂等去重</span>
          </div>
        </div>

        <div className="rounded-md border border-line bg-panel">
          <div className="border-b border-line px-4 py-3.5 text-sm font-semibold">
            最近 24 小时入库
          </div>
          <div className="flex h-[120px] items-end gap-[3px] px-4 pt-4">
            {hourly.map((h) => (
              <span
                key={h.hourLabel}
                title={`${h.hourLabel}:00 — ${h.count} 条`}
                className="min-w-[3px] flex-1 rounded-t-sm bg-accent opacity-80 hover:opacity-100"
                style={{ height: `${Math.max((h.count / maxHour) * 100, h.count > 0 ? 4 : 2)}%` }}
              />
            ))}
          </div>
          <div className="flex justify-between px-4 pb-3 pt-1.5 font-mono text-[10.5px] text-text-3">
            {["00", "04", "08", "12", "16", "20", "23"].map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        </div>
      </div>

      {/* 采集日历热力图(原型 heat-grid:周对齐 7 行 × 列) */}
      <div className="rounded-md border border-line bg-panel">
        <div className="border-b border-line px-4 py-3.5 text-sm font-semibold">
          采集日历(近 14 天入库,含隐藏)
        </div>
        <div className="overflow-x-auto p-4">
          <div
            className="grid auto-flow-col grid-rows-7 gap-[3px]"
            style={{ gridAutoColumns: "12px" }}
          >
            {/* 周一对齐:首日前置空格(auto-flow-col 下占满第一列) */}
            {calendar[0] &&
              Array.from(
                { length: (new Date(`${calendar[0].day}T00:00:00Z`).getUTCDay() + 6) % 7 },
                (_, i) => <i key={`pad-${i}`} className="h-3 w-3 rounded-sm" />,
              )}
            {calendar.map((c) => (
              <i
                key={c.day}
                title={`${c.day} — ${c.count} 条`}
                className="h-3 w-3 rounded-sm"
                style={heatStyle(c.count, maxDay)}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center gap-4 font-mono text-[10.5px] text-text-3">
            <span>{calendar[0]?.day}</span>
            <span>{calendar[calendar.length - 1]?.day}</span>
            <span className="ml-auto flex items-center gap-1">
              少
              <i className="h-2.5 w-2.5 rounded-sm bg-panel-2" />
              <i className="h-2.5 w-2.5 rounded-sm bg-accent/30" />
              <i className="h-2.5 w-2.5 rounded-sm bg-accent/60" />
              <i className="h-2.5 w-2.5 rounded-sm bg-accent" />多
            </span>
          </div>
        </div>
      </div>

      {/* 最近错误(原型 err-row) */}
      <div className="rounded-md border border-line bg-panel">
        <div className="border-b border-line px-4 py-3.5 text-sm font-semibold">
          最近错误(队列失败任务,至多 5 条)
        </div>
        {snapshot.recentFailed.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-text-3">无失败任务</p>
        ) : (
          snapshot.recentFailed.map((f) => (
            <div
              key={f.id}
              className="grid grid-cols-[64px_120px_1fr] items-center gap-3 border-b border-line px-4 py-2.5 text-[13px] last:border-b-0"
            >
              <span className="font-mono text-xs text-text-3">{hhmm(f.at)}</span>
              <span className="whitespace-nowrap font-mono text-xs text-text-2">{f.name}</span>
              <span className="truncate font-mono text-xs text-red" title={f.reason}>
                {f.reason}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
