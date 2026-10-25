/**
 * F20 监视格 2×2:文字渠道 / 视频博主 / 批次任务 / 队列 四张状态卡,每卡
 * 归一为 正常(绿)/ 采集中(琥珀)/ 滞后(琥珀)/ 故障(红)一态 + 两行
 * 实况明细。全部由现有观测数据推导(渠道连败与脱期、视频运行态、job_run
 * 末次、队列积压与 tick 存活),缺数据显空态不造假。
 */
import { crawlerActiveRuns, videoRunningSince } from "@/lib/collect/crawler-runs";
import { registryIntervalMs, registryJobRunKeys } from "@/lib/collect/plan-rows";
import { formatCnTime } from "@/lib/datetime";
import { listHotSourcesAdmin } from "@/lib/insight/hot-source";
import { listBloggersAdmin } from "@/lib/telegram/bloggers-admin";
import { listChannelsAdmin } from "@/lib/telegram/channels-admin";
import {
  getCrawlerQueueSnapshot,
  getIngestCalendar,
  getVideoObservation,
} from "@/lib/telegram/spider-queries";
import { jobRunHealth } from "@/lib/jobs/runlog-admin";

type State = "normal" | "running" | "lag" | "fail";

const STATE_META: Record<State, { label: string; cls: string; dot: string }> = {
  normal: { label: "正常", cls: "text-green", dot: "bg-green" },
  running: { label: "采集中", cls: "text-amber-hi", dot: "animate-pulse bg-amber" },
  lag: { label: "滞后", cls: "text-amber-hi", dot: "bg-amber" },
  fail: { label: "故障", cls: "text-red", dot: "bg-red" },
};

interface Card {
  key: string;
  title: string;
  state: State;
  line1: string;
  line2: string;
}

function MonitorCard({ card }: { card: Card }): React.ReactElement {
  const meta = STATE_META[card.state];
  return (
    <div className="rounded-md border border-line bg-panel px-4 py-3.5">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <i className={`inline-block h-2 w-2 rounded-full ${meta.dot}`} />
        <span className="text-text-1">{card.title}</span>
        <span className={`ml-auto text-xs ${meta.cls}`}>{meta.label}</span>
      </div>
      <div className="mt-2 space-y-0.5 text-[11px] leading-relaxed text-text-3">
        <div>{card.line1}</div>
        <div>{card.line2}</div>
      </div>
    </div>
  );
}

/** 渠道滞后计数:enabled 且 nextRunAt 已逾期超 2× 间隔仍未跑 */
function laggedCount(channels: Awaited<ReturnType<typeof listChannelsAdmin>>): number {
  const now = Date.now();
  return channels.filter(
    (c) =>
      c.enabled &&
      c.nextRunAt !== null &&
      now - c.nextRunAt.getTime() > 2 * c.crawlIntervalMin * 60_000,
  ).length;
}

export default async function MonitorGrid(): Promise<React.ReactElement> {
  const [
    channels,
    bloggers,
    runningSince,
    activeRuns,
    video,
    calendar,
    snapshot,
    health,
    hotSources,
  ] = await Promise.all([
    listChannelsAdmin(),
    listBloggersAdmin(),
    videoRunningSince(),
    crawlerActiveRuns(),
    getVideoObservation(),
    getIngestCalendar(2),
    getCrawlerQueueSnapshot(),
    jobRunHealth(),
    listHotSourcesAdmin(),
  ]);

  const today = calendar[calendar.length - 1]?.count ?? 0;
  const backlog = snapshot.counts.waiting + snapshot.counts.delayed;

  // 卡1 文字渠道:连败故障 > 脱期滞后 > 采集中 > 正常
  const chFails = channels.filter((c) => c.enabled && c.consecutiveFails >= 3);
  const chLag = laggedCount(channels);
  const chRunning = activeRuns.some((a) => a.kind === "rss");
  const ch: Card = {
    key: "rss",
    title: "文字渠道",
    state: chFails.length > 0 ? "fail" : chLag > 0 ? "lag" : chRunning ? "running" : "normal",
    line1: `启用 ${channels.filter((c) => c.enabled).length} 渠道 · 今日入库 ${today} 条`,
    line2:
      chFails.length > 0
        ? `${chFails.length} 渠道连败(${chFails
            .slice(0, 2)
            .map((c) => c.name)
            .join("、")}…)`
        : chLag > 0
          ? `${chLag} 渠道超 2× 间隔未跑 · 预计下轮 tick 追平`
          : `按间隔轮转 · 热榜源 ${hotSources.filter((h) => h.enabled).length} 个在册`,
  };

  // 卡2 视频博主:运行态 > 连败 > 正常
  const bFails = bloggers.filter((b) => b.enabled && b.consecutiveFails >= 3);
  const bLag = bloggers.filter(
    (b) => b.enabled && b.lastRunAt !== null && Date.now() - b.lastRunAt.getTime() > 3 * 3_600_000,
  ).length;
  const v: Card = {
    key: "video",
    title: "视频博主",
    state:
      bFails.length > 0 ? "fail" : runningSince.size > 0 ? "running" : bLag > 0 ? "lag" : "normal",
    line1: `博主 ${video.bloggerCount}(调度中 ${video.enabledCount})· 24h 入库 ${video.videoCount24h} 条`,
    line2:
      runningSince.size > 0
        ? `采集中 ${runningSince.size} 平台 · 最新一条 ${video.lastVideoAt === null ? "—" : formatCnTime(video.lastVideoAt)}`
        : bFails.length > 0
          ? `${bFails.length} 博主连败 ≥3 · Cookie/代理可回 博主台账 排查`
          : `轮转等待下一窗口 · 最新 ${video.lastVideoAt === null ? "—" : formatCnTime(video.lastVideoAt)}`,
  };

  // 卡3 批次任务(job_run):红(连败≥2)> 脱期 > 运行中 > 正常
  const redKeys = health.keys.filter((k) => (health.streaks[k.jobKey] ?? 0) >= 2);
  const overdue = registryJobRunKeys().filter((jk) => {
    const iv = registryIntervalMs(jk);
    if (iv === null) return false;
    const k = health.keys.find((x) => x.jobKey === jk);
    const last = k
      ? ([k.lastSuccessAt, k.lastFailedAt]
          .filter((d): d is Date => d !== null)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null)
      : null;
    return last === null || Date.now() - last.getTime() > 2 * iv;
  });
  const runningKeys = health.keys.filter((k) => k.runningNow > 0);
  const j: Card = {
    key: "jobs",
    title: "批次任务",
    state:
      redKeys.length > 0
        ? "fail"
        : overdue.length > 0
          ? "lag"
          : runningKeys.length > 0
            ? "running"
            : "normal",
    line1: `落账 ${health.keys.length} 任务 · 24h ${health.keys.reduce((a, k) => a + k.total24h, 0)} 轮`,
    line2:
      redKeys.length > 0
        ? `${redKeys.length} 任务连败 ≥2 · 归因见健康页`
        : overdue.length > 0
          ? `${overdue.length} 任务超 2× 间隔未跑`
          : runningKeys.length > 0
            ? `${runningKeys.length} 任务进行中`
            : health.hung.length > 0
              ? `${health.hung.length} 任务疑似挂起`
              : "全部任务在期",
  };

  // 卡4 队列:tick 未注册 = 故障 > 积压滞后 > 正常
  const q: Card = {
    key: "queue",
    title: "队列",
    state: !snapshot.tickAlive ? "fail" : backlog > 50 ? "lag" : "normal",
    line1: `BullMQ · waiting ${snapshot.counts.waiting} / delayed ${snapshot.counts.delayed} / active ${snapshot.counts.active}`,
    line2: !snapshot.tickAlive
      ? "tick 调度器未注册(worker 未启动?)"
      : backlog > 50
        ? `积压 ${backlog} 条 · 消化速率见队列实况`
        : `tick 存活 · 每 60s 扫描到期渠道`,
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[ch, v, j, q].map((c) => (
        <MonitorCard key={c.key} card={c} />
      ))}
    </div>
  );
}
