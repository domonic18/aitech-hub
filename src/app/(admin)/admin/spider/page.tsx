/**
 * 采集总览页(M7 批④c;2026-10-04 按原型 admin-spider 重排):4 KPI 卡 +
 * 队列堆叠条/24h 入库条带(mid-grid 1fr 360px)+ 采集日历热力图 + 最近错误行。
 * 纯只读 RSC;KPI/队列行/热力图在 components/admin/spider,本件只做取数编排。
 * 渠道健康明细在台账页(/admin/channels),治理动作在电报流治理页。
 */
import Link from "next/link";

import IngestHeatmap from "@/components/admin/spider/IngestHeatmap";
import QueueLane from "@/components/admin/spider/QueueLane";
import SpiderKpiCards from "@/components/admin/spider/SpiderKpiCards";
import { requireAdminPage } from "@/lib/auth/guard";
import { formatCnTime } from "@/lib/datetime";
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

export const dynamic = "force-dynamic";

/** 空值展示「—」的 HH:mm(formatCnTime 同口径) */
function hhmm(at: Date | null): string {
  return at === null ? "—" : formatCnTime(at);
}

export default async function AdminSpiderPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const [snapshot, calendar, hourly, stock, channels, video, interpreter, summarizer, github] =
    await Promise.all([
      getCrawlerQueueSnapshot(),
      getIngestCalendar(84),
      getIngestHourly(),
      getTelegramStock(),
      listChannelsAdmin(),
      getVideoObservation(),
      getInterpreterQueueSnapshot(),
      getSummarizerQueueSnapshot(),
      getGithubQueueSnapshot(),
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
          worker 运行态与采集实况;渠道健康度明细见
          <Link href="/admin/channels/" className="mx-1 text-accent hover:text-accent-hover">
            渠道台账
          </Link>
          ,治理动作见电报流治理页。
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
                    failed
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
                    {interpreter.dailyMax}
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
                    {summarizer.dailyMax}
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
                    <span>台账在 GitHub 仓库页;限频/网络故障顺延不计连败,上游 4xx 计连败</span>
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
