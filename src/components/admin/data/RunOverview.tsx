/**
 * 数据中心·运行总览视图(原采集总览页,M7 批④c→2026-10-18 数据壳重组迁入):
 * 4 KPI 卡 + 队列堆叠条/24h 入库条带 + 采集日历热力图 + 信号采集强度(趋势/
 * 时段/分源台账)+ 最近错误行。纯只读 RSC;守卫在 data/run 页,本件只做取数编排。
 */
import Link from "next/link";

import HourHeat from "@/components/admin/insight/HourHeat";
import TrendBars from "@/components/admin/insight/TrendBars";
import IngestHeatmap from "@/components/admin/spider/IngestHeatmap";
import QueueLane from "@/components/admin/spider/QueueLane";
import SpiderKpiCards from "@/components/admin/spider/SpiderKpiCards";
import SourceLedger, { LEDGER_SOURCES } from "@/components/admin/spider/SourceLedger";
import { formatCnTime } from "@/lib/datetime";
import { insightOverview } from "@/lib/insight/admin";
import { insightHourHeat, insightTrendDaily } from "@/lib/insight/trends";
import { listChannelsAdmin } from "@/lib/telegram/channels-admin";
import {
  getCrawlerQueueSnapshot,
  getGithubQueueSnapshot,
  getInterpreterQueueSnapshot,
  getIngestCalendar,
  getIngestHourly,
  getSummarizerQueueSnapshot,
  getTelegramStock,
  getVideoObservation,
} from "@/lib/telegram/spider-queries";

/** 空值展示「—」的 HH:mm(formatCnTime 同口径) */
function hhmm(at: Date | null): string {
  return at === null ? "—" : formatCnTime(at);
}

/** 最老等待展示(M15 批④):≥1min 显 Xm,<1min 显 s,null(队列空)显「—」。
 * BullMQ 事件驱动无轮询周期——该值感知的是消化速率(并发 1 串行积压),
 * 非「多久后开始处理」;配额顺延的 job 在 delayed 不计入此值。 */
function oldestWait(ms: number | null): string {
  if (ms === null) return "—";
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`;
}

export default async function RunOverview(): Promise<React.ReactElement> {
  const [
    snapshot,
    calendar,
    hourly,
    stock,
    channels,
    video,
    interpreter,
    summarizer,
    github,
    trend,
    hourHeat,
    insight,
  ] = await Promise.all([
    getCrawlerQueueSnapshot(),
    getIngestCalendar(84),
    getIngestHourly(),
    getTelegramStock(),
    listChannelsAdmin(),
    getVideoObservation(),
    getInterpreterQueueSnapshot(),
    getSummarizerQueueSnapshot(),
    getGithubQueueSnapshot(),
    insightTrendDaily(),
    insightHourHeat(),
    insightOverview(),
  ]);
  const today = calendar[calendar.length - 1]?.count ?? 0;
  const yesterday = calendar[calendar.length - 2]?.count ?? 0;
  const maxHour = Math.max(1, ...hourly.map((h) => h.count));
  const enabledChannels = channels.filter((c) => c.enabled).length;
  const backlog = snapshot.counts.waiting + snapshot.counts.delayed;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">采集总览</h2>
        <p className="mt-0.5 text-xs text-text-3">
          worker 运行态与采集实况;渠道健康度明细切上方「渠道」页签,治理动作见电报管理页。
        </p>
      </div>

      {/* KPI ×4(原型 kpi-grid) */}
      <SpiderKpiCards
        today={today}
        yesterday={yesterday}
        stock={stock}
        backlog={backlog}
        active={snapshot.counts.active}
        completed={snapshot.counts.completed}
        failed={snapshot.counts.failed}
        enabledChannels={enabledChannels}
      />

      {/* 短视频观测细带(M8;博主明细与 Cookie 池在发现中心「博主」页签) */}
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
        <Link
          href="/admin/data/mine/?t=bloggers"
          className="ml-auto text-accent hover:text-accent-hover"
        >
          博主台账 →
        </Link>
      </div>

      {/* 双队列实况 + 24h 条带(原型 mid-grid 1fr 360px;M9 起 interpreter 真实计数) */}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rounded-md border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3.5 text-sm font-semibold">
            队列实况
            <span className="font-mono text-[11px] font-normal text-text-3">BullMQ</span>
          </div>
          <div className="px-4 py-4">
            {/* crawler:文字渠道 + 视频博主同队列调度(arch/02 §3.2 注记) */}
            <QueueLane
              icon="i-cloudserver"
              name="crawler"
              desc={
                <>
                  文字 + 视频抓取 · {enabledChannels} 渠道 + {video.enabledCount} 博主
                </>
              }
              counts={snapshot.counts}
              legend={
                <>
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
                    failed(留存累计,非当前失败)
                  </span>
                  <span className="text-text-3/80">视频博主 crawl-video 与文字渠道同队列调度</span>
                </>
              }
            />

            {/* interpreter(M9 实况):下载/抽轨/ASR/LLM,并发 1(ffmpeg CPU 峰值) */}
            <div className="mt-4 border-t border-line pt-4">
              <QueueLane
                icon="i-robot"
                name="interpreter"
                desc={
                  <>
                    视频解读 · 下载 / 抽轨 / ASR / LLM · 并发 1 · 今日 {interpreter.todayDone}/
                    {interpreter.dailyMax} · 最老等待 {oldestWait(interpreter.oldestWaitingMs)}
                  </>
                }
                counts={interpreter.counts}
                iconPulse
                legend={
                  <>
                    <span>
                      <i className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-panel-2" />
                      completed(近 50 留存)
                    </span>
                    <span>日配额超限延迟 30min 重投(delayed),失败条目经治理台「解读」按钮重试</span>
                  </>
                }
              />
            </div>

            {/* summarizer(M12 批③ 实况;批⑥ 契约 v2):文字轻解读——中心思想 + 要点 + 关键词,默认并发 2 */}
            <div className="mt-4 border-t border-line pt-4">
              <QueueLane
                icon="i-filetext"
                name="summarizer"
                desc={
                  <>
                    文字轻解读 · 中心思想 + 要点 + 关键词 · 并发 2 · 今日 {summarizer.todayDone}/
                    {summarizer.dailyMax} · 最老等待 {oldestWait(summarizer.oldestWaitingMs)}
                  </>
                }
                counts={summarizer.counts}
                iconPulse
                legend={
                  <>
                    <span>
                      <i className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-panel-2" />
                      completed(近 50 留存)
                    </span>
                    <span>日配额与视频解读分开计;摘要 &lt;80 字自动抓原文粗提取(失败降级)</span>
                  </>
                }
              />
            </div>

            {/* github(M11 实况):白名单仓 meta/README/动态同步,github-tick 每 5min 扫描 */}
            <div className="mt-4 border-t border-line pt-4">
              <QueueLane
                icon="i-github"
                name="github"
                desc={
                  <>
                    开源项目白名单同步 · {github.repoCount} 仓(
                    {github.enabledCount} 调度中)
                  </>
                }
                counts={github.counts}
                iconPulse
                legend={
                  <>
                    <span>
                      <i className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-panel-2" />
                      completed(近 200 留存)
                    </span>
                    <span>台账在项目展示页;限频/网络故障顺延不计连败,上游 4xx 计连败</span>
                  </>
                }
              />
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
            <span>GitHub 同步 github-tick 每 5 分钟扫描到期仓库</span>
            <span>AI 补扫 ai-backfill-tick 每 5 分钟消化未解读存量(各限 5 条/轮)</span>
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
      <IngestHeatmap calendar={calendar} />

      {/* 信号采集强度(M34 批③ 验收反馈·问题2 自洞察中心迁入):趋势+时段+台账 */}
      <div>
        <div className="mb-2 flex items-baseline gap-2">
          <h3 className="text-sm font-semibold">信号采集强度</h3>
          <span className="text-[11px] text-text-3">
            洞察信号池近 7 日趋势与时段分布(北京墙钟);分源明细台账见下,信号流在洞察中心
          </span>
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-md border border-line bg-panel px-4 py-4">
            <div className="mb-3 text-xs font-medium text-text-2">近 7 日分源趋势</div>
            <TrendBars days={trend} sources={LEDGER_SOURCES} />
          </div>
          <div className="rounded-md border border-line bg-panel px-4 py-4">
            <div className="mb-3 text-xs font-medium text-text-2">时段热力(周 × 24 时)</div>
            <HourHeat cells={hourHeat} />
          </div>
        </div>
      </div>

      <SourceLedger stats={insight.bySource} />

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
              className="grid grid-cols-[64px_140px_1fr] items-center gap-3 border-b border-line px-4 py-2.5 text-[13px] last:border-b-0"
            >
              <span className="font-mono text-xs text-text-3">{hhmm(f.at)}</span>
              {/* 渠道名(job data 过境;旧 job/github 队列退 job 名) */}
              <span
                className="truncate whitespace-nowrap font-mono text-xs text-text-2"
                title={f.sourceName ?? f.name}
              >
                {f.sourceName ?? f.name}
              </span>
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
