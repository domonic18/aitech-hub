/**
 * F20 实时页折叠保留区(W2 BloggerStatusCards 同款「能力保留位」策略):
 * 队列实况四泳道 / 入库观测(KPI+24h 条带+热力)/ 信号采集强度 / 最近错误
 * ——均为板外的既有观测能力,折叠收纳不裁撤。各段自取数,展开才付查询。
 */
import Link from "next/link";

import HourHeat from "@/components/admin/insight/HourHeat";
import TrendBars from "@/components/admin/insight/TrendBars";
import IngestHeatmap from "@/components/admin/spider/IngestHeatmap";
import QueueLane from "@/components/admin/spider/QueueLane";
import SpiderKpiCards from "@/components/admin/spider/SpiderKpiCards";
import SourceLedger, { LEDGER_SOURCES } from "@/components/admin/spider/SourceLedger";
import { insightOverview } from "@/lib/insight/admin";
import { insightHourHeat, insightTrendDaily } from "@/lib/insight/trend-series";
import { listChannelsAdmin } from "@/lib/telegram/channels-admin";
import {
  getCrawlerQueueSnapshot,
  getGithubQueueSnapshot,
  getIngestCalendar,
  getIngestHourly,
  getInterpreterQueueSnapshot,
  getSummarizerQueueSnapshot,
  getTelegramStock,
  getVideoObservation,
} from "@/lib/telegram/spider-queries";

function Fold({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <details className="group rounded-md border border-line bg-panel">
      <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-3 text-sm font-semibold marker:content-none">
        <span className="flex items-center gap-2">
          <i className="text-[10px] text-text-3 transition-transform group-open:rotate-90">▶</i>
          {title}
        </span>
        <span className="text-[11px] font-normal text-text-3">{hint}</span>
      </summary>
      <div className="border-t border-line px-4 py-4">{children}</div>
    </details>
  );
}

/** 空值展示「—」的 HH:mm */
function hhmm(at: Date | null): string {
  return at === null
    ? "—"
    : at.toLocaleTimeString("sv-SE", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** 最老等待(M15 批④):≥1min 显 Xm,<1min 显 s,null 显「—」 */
function oldestWait(ms: number | null): string {
  if (ms === null) return "—";
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`;
}

export async function QueueFold(): Promise<React.ReactElement> {
  const [snapshot, interpreter, summarizer, github, channels, video] = await Promise.all([
    getCrawlerQueueSnapshot(),
    getInterpreterQueueSnapshot(),
    getSummarizerQueueSnapshot(),
    getGithubQueueSnapshot(),
    listChannelsAdmin(),
    getVideoObservation(),
  ]);
  const enabledChannels = channels.filter((c) => c.enabled).length;
  return (
    <Fold title="队列实况" hint="BullMQ 四泳道 · tick 存活 · 展开查看">
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
      <div className="mt-4 border-t border-line pt-4">
        <QueueLane
          icon="i-github"
          name="github"
          desc={
            <>
              开源项目白名单同步 · {github.repoCount} 仓({github.enabledCount} 调度中)
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
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-3 font-mono text-xs text-text-3">
        <span>
          tick 调度器
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
    </Fold>
  );
}

export async function IngestFold(): Promise<React.ReactElement> {
  const [calendar, hourly, stock, snapshot, channels] = await Promise.all([
    getIngestCalendar(84),
    getIngestHourly(),
    getTelegramStock(),
    getCrawlerQueueSnapshot(),
    listChannelsAdmin(),
  ]);
  const today = calendar[calendar.length - 1]?.count ?? 0;
  const yesterday = calendar[calendar.length - 2]?.count ?? 0;
  const maxHour = Math.max(1, ...hourly.map((h) => h.count));
  return (
    <Fold title="入库观测" hint="KPI · 24h 条带 · 12 周热力 · 展开查看">
      <SpiderKpiCards
        today={today}
        yesterday={yesterday}
        stock={stock}
        backlog={snapshot.counts.waiting + snapshot.counts.delayed}
        active={snapshot.counts.active}
        completed={snapshot.counts.completed}
        failed={snapshot.counts.failed}
        enabledChannels={channels.filter((c) => c.enabled).length}
      />
      <div className="mt-4 rounded-md border border-line px-4 py-4">
        <div className="mb-2 text-xs font-medium text-text-2">最近 24 小时入库</div>
        <div className="flex h-[100px] items-end gap-[3px]">
          {hourly.map((h) => (
            <span
              key={h.hourLabel}
              title={`${h.hourLabel}:00 — ${h.count} 条`}
              className="min-w-[3px] flex-1 rounded-t-sm bg-accent opacity-80 hover:opacity-100"
              style={{ height: `${Math.max((h.count / maxHour) * 100, h.count > 0 ? 4 : 2)}%` }}
            />
          ))}
        </div>
        <div className="flex justify-between pt-1.5 font-mono text-[10.5px] text-text-3">
          {["00", "04", "08", "12", "16", "20", "23"].map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      </div>
      <div className="mt-4">
        <IngestHeatmap calendar={calendar} />
      </div>
    </Fold>
  );
}

export async function SignalFold(): Promise<React.ReactElement> {
  const [trend, hourHeat, insight] = await Promise.all([
    insightTrendDaily(),
    insightHourHeat(),
    insightOverview(),
  ]);
  return (
    <Fold title="信号采集强度" hint="洞察信号池近 7 日趋势与时段 · 展开查看">
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-md border border-line px-4 py-4">
          <div className="mb-3 text-xs font-medium text-text-2">近 7 日分源趋势</div>
          <TrendBars days={trend} sources={LEDGER_SOURCES} />
        </div>
        <div className="rounded-md border border-line px-4 py-4">
          <div className="mb-3 text-xs font-medium text-text-2">时段热力(周 × 24 时)</div>
          <HourHeat cells={hourHeat} />
        </div>
      </div>
      <div className="mt-4">
        <SourceLedger stats={insight.bySource} />
      </div>
    </Fold>
  );
}

export async function ErrorsFold(): Promise<React.ReactElement> {
  const snapshot = await getCrawlerQueueSnapshot();
  return (
    <Fold title="最近错误" hint="队列失败任务 · 至多 5 条 · 展开查看">
      {snapshot.recentFailed.length === 0 ? (
        <p className="py-2 text-center text-xs text-text-3">无失败任务</p>
      ) : (
        snapshot.recentFailed.map((f) => (
          <div
            key={f.id}
            className="grid grid-cols-[64px_140px_1fr] items-center gap-3 border-b border-line py-2.5 text-[13px] last:border-b-0"
          >
            <span className="font-mono text-xs text-text-3">{hhmm(f.at)}</span>
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
      <div className="pt-2 text-right">
        <Link
          href="/admin/data/run/?t=jobs"
          className="text-[11px] text-accent hover:text-accent-hover"
        >
          完整执行流水 →
        </Link>
      </div>
    </Fold>
  );
}
