/**
 * 运营巡查健康度判定(M75 运维面):把各域健康读侧拼成「问题清单」。
 *
 * 纯函数、零库依赖(与 pricing/public.ts 同纪律)——写侧与读侧共用,单测直打。
 *
 * 为什么要有:采集是异步的(worker 定时跑),**源挂了前台看不出来**,只表现为
 * 「内容/价格不更新」;站长本地的运营助手 agent 需要一份能直接写进周报的
 * 结构化问题清单,而不是一堆原始计数——本模块就是那把尺。
 *
 * 口径与后台板面对齐:健康态用采集源自身的 status/连败(healthOf 与
 * listPricingSourceHealth 同源),阈值集中在 HEALTH_THRESHOLDS 一处。
 */

import { ECI_CONSECUTIVE_FAILS, ECI_STALE_DAYS } from "@/lib/ai-index/constants";

/** 巡查域(与工具入参 domains 同名) */
export type HealthDomain = "pricing" | "telegram" | "video" | "queue" | "aiindex";

/** 严重度:critical=源已挂/数据已脏(需尽快处理);warning=降级/积压(可排期) */
export type HealthSeverity = "critical" | "warning";

/** 一条问题 */
export interface HealthProblem {
  domain: HealthDomain;
  /** 问题类型(如 source_error / queue_backlog) */
  kind: string;
  severity: HealthSeverity;
  /** 问题对象(源名/渠道名/队列名) */
  target: string;
  /** 一句话结论 */
  summary: string;
  /** 证据(错误原文/计数),供周报引用 */
  evidence?: string;
  /** 建议动作 */
  suggest: string;
}

/** 判定阈值(集中一处,免得两处口径漂移) */
export const HEALTH_THRESHOLDS = {
  /** 连败达此数判源已挂(critical) */
  consecutiveFails: 3,
  /** 待终审行数超此数提示积压(warning) */
  pendingRows: 50,
  /** 队列最老 waiting 超此毫秒提示积压(warning) */
  oldestWaitingMs: 30 * 60 * 1000,
  /** AI 日配额使用率超此比例提示逼近上限(warning) */
  dailyQuotaRatio: 0.9,
  /** AI 能力水位(ECI)超过此天数没成功同步,提示上游同步滞后(warning) */
  aiIndexStaleDays: ECI_STALE_DAYS,
  /** AI 能力水位连续拉取失败达此次数判上游链路已挂(critical) */
  aiIndexConsecutiveFails: ECI_CONSECUTIVE_FAILS,
} as const;

// ── 各域输入形状(只取判定需要的字段,避免工具层把整行塞进来) ──────────

export interface PricingHealthInput {
  key: string;
  label: string;
  vendor: string;
  enabled: boolean;
  /** healthy / degraded / error */
  status: string;
  consecutiveFails: number;
  rows: { total: number; pending: number; enabled: number; disabled: number; recheck: number };
  lastCapture: {
    at: Date;
    parseStatus: string;
    rowCount: number | null;
    error: string | null;
  } | null;
}

export interface ChannelHealthInput {
  id: number;
  name: string;
  type: string;
  enabled: boolean;
  consecutiveFails: number;
  status: string;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  count24h: number;
}

export interface BloggerHealthInput {
  id: number;
  nickname: string;
  platform: string;
  enabled: boolean;
  platformEnabled: boolean;
  consecutiveFails: number;
  lastError: string | null;
  lastRunAt: Date | null;
}

export interface QueueHealthInput {
  name: string;
  counts: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  /** 调度器存活(采集 tick 心跳) */
  tickAlive: boolean;
  recentFailed: Array<{
    id: string;
    name: string;
    sourceName: string | null;
    reason: string;
    at: Date | null;
  }>;
  /** 最老 waiting 任务的等待时长(AI 队列有,采集队列无) */
  oldestWaitingMs?: number | null;
  /** 今日已完成 + 日配额(AI 队列有) */
  todayDone?: number;
  dailyMax?: number | null;
}

// ── 各域判定 ──────────────────────────────────────────────────────────

/** AI 智能指数(能力水位 ECI 同步)判定输入 */
export interface AiIndexHealthInput {
  /** 库里已有的 ECI 模型行数 */
  modelCount: number;
  /** 最新模型的 ECI 日期 */
  latestModelDate: string | null;
  /** 最近一次成功写入(ok)的同步时刻 */
  lastOkAt: Date | null;
  /** 最近一次拉取(含 rejected/failed)的时刻 */
  lastAttemptAt: Date | null;
  /** 最近一次拉取状态 */
  lastStatus: string | null;
  /** 最近一次拉取错误/拒收原因 */
  lastError: string | null;
  /** 连续非 ok 的拉取次数 */
  consecutiveFails: number;
  /** 距上次成功同步的天数 */
  staleDays: number | null;
}

/** AI 智能指数:能力水位同步滞后/连续失败/闸门拒收 */
export function aiindexProblems(rows: AiIndexHealthInput[]): HealthProblem[] {
  const out: HealthProblem[] = [];
  for (const r of rows) {
    const target = "AI 能力水位(Epoch ECI)";
    if (r.consecutiveFails >= HEALTH_THRESHOLDS.aiIndexConsecutiveFails) {
      out.push({
        domain: "aiindex",
        kind: "eci_sync_failed",
        severity: "critical",
        target,
        summary: `ECI 同步连续失败 ${r.consecutiveFails} 次,能力基线已停止更新`,
        evidence: r.lastError ?? undefined,
        suggest: "查上游包是否改版/断链;看 ai_index_eci_sync 台账的最近错误原文",
      });
      continue;
    }
    if (r.lastStatus === "rejected") {
      out.push({
        domain: "aiindex",
        kind: "eci_rejected",
        severity: "warning",
        target,
        summary: "ECI 上游数据未通过校验闸门,已保留旧数据继续服务",
        evidence: r.lastError ?? undefined,
        suggest: "多为上游数据异常(行数/分数越界);核对 ai_index_eci_sync 台账",
      });
    }
    if (r.staleDays !== null && r.staleDays > HEALTH_THRESHOLDS.aiIndexStaleDays) {
      out.push({
        domain: "aiindex",
        kind: "eci_stale",
        severity: "warning",
        target,
        summary: `ECI 同步已滞后 ${r.staleDays} 天,能力基线可能不是最新刻度`,
        evidence: `lastOk=${r.lastOkAt?.toISOString().slice(0, 10) ?? "无"}`,
        suggest: "看 ECI 同步 job 的失败原因;上游可达后下轮自动恢复",
      });
    }
    if (r.modelCount === 0) {
      out.push({
        domain: "aiindex",
        kind: "eci_empty",
        severity: "warning",
        target,
        summary: "ECI 能力层还没有任何模型数据,指数里的能力基线为空",
        evidence: `lastStatus=${r.lastStatus ?? "无拉取记录"}`,
        suggest: "确认 worker 的 ai-index 队列在跑,并执行一次 eci-fetch",
      });
    }
  }
  return out;
}

/** 牌价源:连败/状态错误/整源待复核/最近快照失败/待终审积压 */
export function pricingProblems(rows: PricingHealthInput[]): HealthProblem[] {
  const out: HealthProblem[] = [];
  for (const r of rows) {
    if (!r.enabled) continue;
    const name = `${r.label}(${r.key})`;
    if (r.status === "error" || r.consecutiveFails >= HEALTH_THRESHOLDS.consecutiveFails) {
      out.push({
        domain: "pricing",
        kind: "source_error",
        severity: "critical",
        target: name,
        summary: `牌价源 ${r.label} 采集失败(连败 ${r.consecutiveFails} 次)`,
        evidence: r.lastCapture?.error ?? undefined,
        suggest: "看该源最近错误原文;必要时触发手动重采,或临时停用该源避免旧价继续挂着",
      });
    } else if (
      r.status === "degraded" ||
      (r.consecutiveFails > 0 && r.consecutiveFails < HEALTH_THRESHOLDS.consecutiveFails)
    ) {
      out.push({
        domain: "pricing",
        kind: "source_degraded",
        severity: "warning",
        target: name,
        summary: `牌价源 ${r.label} 处于降级(连败 ${r.consecutiveFails} 次)`,
        evidence: r.lastCapture?.error ?? undefined,
        suggest: "观察;连败到 3 次会升级为「源已挂」",
      });
    }
    if (r.rows.recheck > 0) {
      out.push({
        domain: "pricing",
        kind: "rows_recheck",
        severity: "critical",
        target: name,
        summary: `牌价源 ${r.label} 有 ${r.rows.recheck} 行被标「待复核」(上次采集失败,价已陈旧)`,
        evidence: `recheck=${r.rows.recheck},total=${r.rows.total}`,
        suggest: "重采该源刷新价格;未刷新前这些行不宜上架",
      });
    }
    if (r.rows.pending > HEALTH_THRESHOLDS.pendingRows) {
      out.push({
        domain: "pricing",
        kind: "rows_pending",
        severity: "warning",
        target: name,
        summary: `牌价源 ${r.label} 有 ${r.rows.pending} 行待终审(未上架)`,
        evidence: `pending=${r.rows.pending}`,
        suggest: "在 /admin/pricing 批量终审;巡查 agent 也可只上架无「待复核」标的行",
      });
    }
    if (r.lastCapture?.error) {
      out.push({
        domain: "pricing",
        kind: "capture_error",
        severity: "critical",
        target: name,
        summary: `牌价源 ${r.label} 最近一次采集解析失败`,
        evidence: r.lastCapture.error,
        suggest: "查采集快照原文;多为页面改版,需改解析器",
      });
    }
  }
  return out;
}

/** 采集渠道(文章/资讯/厂商动态等):停用、连败、长时间没跑 */
export function channelProblems(rows: ChannelHealthInput[]): HealthProblem[] {
  const out: HealthProblem[] = [];
  for (const r of rows) {
    if (!r.enabled) continue;
    if (r.consecutiveFails >= HEALTH_THRESHOLDS.consecutiveFails) {
      out.push({
        domain: "telegram",
        kind: "channel_error",
        severity: "critical",
        target: `${r.name}(#${r.id})`,
        summary: `渠道 ${r.name} 连续失败 ${r.consecutiveFails} 次`,
        suggest: "触发手动重采;仍失败则查该源页面是否改版/被限流",
      });
    } else if (r.consecutiveFails > 0) {
      out.push({
        domain: "telegram",
        kind: "channel_degraded",
        severity: "warning",
        target: `${r.name}(#${r.id})`,
        summary: `渠道 ${r.name} 最近失败 ${r.consecutiveFails} 次`,
        suggest: "观察;连续 3 次失败会升级",
      });
    }
    if (r.status === "error") {
      out.push({
        domain: "telegram",
        kind: "channel_status_error",
        severity: "critical",
        target: `${r.name}(#${r.id})`,
        summary: `渠道 ${r.name} 状态为 error`,
        suggest: "触发手动重采;必要时在源管理里修配置",
      });
    }
  }
  return out;
}

/** 视频博主:连败/平台行被停用 */
export function videoProblems(rows: BloggerHealthInput[]): HealthProblem[] {
  const out: HealthProblem[] = [];
  for (const r of rows) {
    const name = `${r.nickname || r.platform}(#${r.id})`;
    if (!r.enabled || !r.platformEnabled) continue;
    if (r.consecutiveFails >= HEALTH_THRESHOLDS.consecutiveFails) {
      out.push({
        domain: "video",
        kind: "blogger_error",
        severity: "critical",
        target: name,
        summary: `视频博主 ${name} 连续失败 ${r.consecutiveFails} 次`,
        evidence: r.lastError ?? undefined,
        suggest: "触发手动重采;失败多为账号风控,必要时停用该博主",
      });
    } else if (r.consecutiveFails > 0) {
      out.push({
        domain: "video",
        kind: "blogger_degraded",
        severity: "warning",
        target: name,
        summary: `视频博主 ${name} 最近失败 ${r.consecutiveFails} 次`,
        evidence: r.lastError ?? undefined,
        suggest: "观察",
      });
    }
  }
  return out;
}

/** 队列与 AI 管线:tick 不活/有失败/积压/逼近日配额 */
export function queueProblems(queues: QueueHealthInput[]): HealthProblem[] {
  const out: HealthProblem[] = [];
  for (const q of queues) {
    if (!q.tickAlive) {
      out.push({
        domain: "queue",
        kind: "tick_dead",
        severity: "critical",
        target: q.name,
        summary: `队列 ${q.name} 的调度器不存活(定时任务没在跑)`,
        evidence: `waiting=${q.counts.waiting},failed=${q.counts.failed}`,
        suggest: "查 worker 进程是否存活;tick 死了任务只进不出",
      });
    }
    if (q.counts.failed > 0) {
      out.push({
        domain: "queue",
        kind: "queue_failed",
        severity: "warning",
        target: q.name,
        summary: `队列 ${q.name} 有 ${q.counts.failed} 个失败任务`,
        evidence: q.recentFailed[0]?.reason,
        suggest: "看失败任务原文;必要时清掉失败任务重新入队",
      });
    }
    const oldest = q.oldestWaitingMs ?? null;
    if (oldest !== null && oldest > HEALTH_THRESHOLDS.oldestWaitingMs) {
      out.push({
        domain: "queue",
        kind: "queue_backlog",
        severity: "warning",
        target: q.name,
        summary: `队列 ${q.name} 有 ${q.counts.waiting} 个任务积压,最老已等 ${Math.round(oldest / 60000)} 分钟`,
        evidence: `waiting=${q.counts.waiting},active=${q.counts.active}`,
        suggest: "AI 队列并发有限,积压多半是配额或并发瓶颈;可下调产出或加并发",
      });
    }
    if (
      q.dailyMax !== null &&
      q.dailyMax !== undefined &&
      q.dailyMax > 0 &&
      q.todayDone !== undefined &&
      q.todayDone / q.dailyMax >= HEALTH_THRESHOLDS.dailyQuotaRatio
    ) {
      out.push({
        domain: "queue",
        kind: "quota_near",
        severity: "warning",
        target: q.name,
        summary: `队列 ${q.name} 今日已用 ${q.todayDone}/${q.dailyMax} 配额,接近上限`,
        evidence: `${q.todayDone}/${q.dailyMax}`,
        suggest: "剩余额度不多,必要时暂停该任务或提高日配额",
      });
    }
  }
  return out;
}

// ── 汇总 ──────────────────────────────────────────────────────────────

/** 严重度排序:critical 在前,同档按域与类型定序(结果稳定,便于周报 diff) */
export function sortProblems(problems: HealthProblem[]): HealthProblem[] {
  const rank = (p: HealthProblem): number => (p.severity === "critical" ? 0 : 1);
  return [...problems].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.domain.localeCompare(b.domain) ||
      a.kind.localeCompare(b.kind) ||
      a.target.localeCompare(b.target),
  );
}

/** 截断到上限(超出部分只报数,不静默丢) */
export function trimProblems(
  problems: HealthProblem[],
  limit: number,
): { items: HealthProblem[]; truncated: number } {
  const sorted = sortProblems(problems);
  if (sorted.length <= limit) return { items: sorted, truncated: 0 };
  return { items: sorted.slice(0, limit), truncated: sorted.length - limit };
}
