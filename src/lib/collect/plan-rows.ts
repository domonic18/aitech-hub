/**
 * F21/F22 采集计划聚合:六业务分组(资讯 RSS/热榜/社媒/发现/分析/维护)的
 * PlanRow 列表行与 PlanCalEntry 日历条目。三类来源——文字渠道与热榜源(台账
 * 投影)、视频平台(博主聚合行,运行态经 crawler 队列活跃 job 反查)、cron
 * 登记表(SCHEDULE_REGISTRY,最近运行查 jobRun 末次落账)。时刻推导与文案在
 * ./plan-rows-types(客户端同源,本文件持 prisma/getQueue,不进浏览器包)。
 */
import type { JobRun } from "@prisma/client";

import { prisma } from "../db";
import { formatCnTime } from "../datetime";
import {
  CRAWL_SOURCE_TYPE_SOCIAL_VIDEO,
  SOCIAL_CRAWL_INTERVAL_MIN,
  VIDEO_PLATFORM_LABELS,
} from "../telegram/constants";
import { listChannelsAdmin } from "../telegram/channels-admin";
import { listHotSourcesAdmin } from "../insight/hot-source";
import {
  CALENDAR_MAX_FIRES_PER_DAY,
  INSIGHT_FETCH_CRON,
  parseCron,
  SCHEDULE_REGISTRY,
} from "./schedules";
import { intervalText } from "./channel-ledger-types";
import { videoRunningSince } from "./crawler-runs";
import {
  cadenceLabel,
  cronCal,
  formatLastRun,
  formatNextRuns,
  intervalCal,
  nextCronRuns,
  nextIntervalRuns,
  PLAN_GROUPS,
  type PlanCalEntry,
  type PlanGroup,
  type PlanRow,
} from "./plan-rows-types";

export { PLAN_GROUPS };
export type { PlanCalEntry, PlanGroup, PlanRow };

export interface PlanBoardData {
  rows: PlanRow[];
  calEntries: PlanCalEntry[];
}

function registryGroup(category: string): PlanGroup {
  if (category === "discovery") return "discovery";
  if (category === "insight") return "analysis";
  return "maint";
}

async function rssRows(): Promise<{ rows: PlanRow[]; entries: PlanCalEntry[] }> {
  const items = await listChannelsAdmin();
  return {
    rows: items.map((c) => {
      const ok = c.consecutiveFails === 0;
      return {
        key: `rss-${c.id}`,
        group: "rss",
        name: c.name,
        cadence: intervalText(c.crawlIntervalMin),
        nextText: formatNextRuns(
          c.enabled ? nextIntervalRuns(c.nextRunAt, c.crawlIntervalMin, 3) : [],
        ),
        enabled: c.enabled,
        running: false,
        lastRun:
          c.lastRunAt === null ? null : { text: formatLastRun(c.lastRunAt, ok, null) ?? "—", ok },
        links: { edit: "/admin/data/sources/?t=channels", logs: "/admin/data/run/?t=jobs" },
      };
    }),
    entries: items.map((c) =>
      intervalCal({
        key: `rss-${c.id}`,
        group: "rss",
        label: c.name,
        intervalMin: c.crawlIntervalMin,
        nextRunAt: c.nextRunAt,
        enabled: c.enabled,
      }),
    ),
  };
}

async function hotRows(): Promise<{ rows: PlanRow[]; entries: PlanCalEntry[] }> {
  const [items, parsed] = [await listHotSourcesAdmin(), parseCron(INSIGHT_FETCH_CRON)];
  if (parsed === null) return { rows: [], entries: [] }; // 常量解析失败 = 代码bug,宁缺勿假
  const next = nextCronRuns(parsed, 3);
  const cadence = cadenceLabel(parsed);
  return {
    rows: items.map((h) => {
      const ok = h.consecutiveFails === 0;
      return {
        key: `hot-${h.source}`,
        group: "hot",
        name: h.label,
        cadence,
        nextText: formatNextRuns(h.enabled ? next : []),
        enabled: h.enabled,
        running: false,
        lastRun:
          h.lastRunAt === null ? null : { text: formatLastRun(h.lastRunAt, ok, null) ?? "—", ok },
        links: { edit: "/admin/data/sources/?t=channels", logs: "/admin/data/run/?t=jobs" },
      };
    }),
    entries: items.map((h) =>
      cronCal({
        key: `hot-${h.source}`,
        group: "hot",
        label: h.label,
        parsed,
        enabled: h.enabled,
      }),
    ),
  };
}

/** 社媒 = 每平台一行(博主聚合):节奏取启用博主最短间隔,下次执行取最早
 *  nextRunAt,运行态任一账号在采即亮;编辑/日志回 博主台账与运行页 */
async function socialRows(): Promise<{ rows: PlanRow[]; entries: PlanCalEntry[] }> {
  const [platformRows, bloggers, runningSince] = await Promise.all([
    prisma.crawlSource.findMany({
      where: { type: CRAWL_SOURCE_TYPE_SOCIAL_VIDEO },
      orderBy: { id: "asc" },
    }),
    prisma.socialAccount.findMany({
      select: {
        platform: true,
        enabled: true,
        crawlIntervalMin: true,
        nextRunAt: true,
        lastRunAt: true,
        consecutiveFails: true,
      },
    }),
    videoRunningSince(),
  ]);
  const rows: PlanRow[] = [];
  const entries: PlanCalEntry[] = [];
  for (const p of platformRows) {
    const platform = p.platform ?? p.name;
    const label = `${VIDEO_PLATFORM_LABELS[platform] ?? platform}博主采集`;
    const mine = bloggers.filter((b) => b.platform === platform);
    const active = mine.filter((b) => b.enabled);
    const minInterval = Math.min(
      ...active.map((b) => b.crawlIntervalMin),
      SOCIAL_CRAWL_INTERVAL_MIN,
    );
    const earliestNext = active.reduce<Date | null>(
      (acc, b) => (b.nextRunAt !== null && (acc === null || b.nextRunAt < acc) ? b.nextRunAt : acc),
      null,
    );
    const lastRunAt = mine.reduce<Date | null>(
      (acc, b) => (b.lastRunAt !== null && (acc === null || b.lastRunAt > acc) ? b.lastRunAt : acc),
      null,
    );
    const anyFails = active.some((b) => b.consecutiveFails > 0);
    const since = runningSince.get(platform);
    const lastRunText = formatLastRun(lastRunAt, !anyFails, since ?? null);
    rows.push({
      key: `social-${platform}`,
      group: "social",
      name: label,
      cadence: `每 ${Math.round(minInterval / 60)} 小时`,
      nextText: formatNextRuns(p.enabled ? nextIntervalRuns(earliestNext, minInterval, 3) : []),
      enabled: p.enabled,
      running: since !== undefined,
      lastRun: lastRunText === null ? null : { text: lastRunText, ok: !anyFails },
      links: {
        edit: "/admin/data/sources/?t=bloggers",
        logs: "/admin/data/run/?t=jobs",
        ...(since !== undefined ? { live: "/admin/data/run/?t=overview" } : {}),
      },
    });
    entries.push(
      intervalCal({
        key: `social-${platform}`,
        group: "social",
        label,
        intervalMin: minInterval,
        nextRunAt: earliestNext,
        enabled: p.enabled,
      }),
    );
  }
  return { rows, entries };
}

/** 发现/分析/维护 = 登记表投影:节奏与未来 3 次由 cron 推导,最近运行查
 *  jobRun 末次落账(embed-reconcile 不入账 → 恒显「—」) */
async function registryRows(): Promise<{ rows: PlanRow[]; entries: PlanCalEntry[] }> {
  const defs = SCHEDULE_REGISTRY.map((def) => {
    const parsed = parseCron(def.cron);
    return parsed === null ? null : { def, parsed, group: registryGroup(def.category) };
  }).filter((d): d is NonNullable<typeof d> => d !== null);
  const runs = await Promise.all(
    defs.map((d) => {
      // M48 批E:jobRun 键随登记表 def 单源(schedules.ts#CronScheduleDef.jobRunKey)
      const jobKey = d.def.jobRunKey;
      return jobKey === undefined
        ? Promise.resolve(null)
        : prisma.jobRun.findFirst({ where: { jobKey }, orderBy: { startedAt: "desc" } });
    }),
  );
  return {
    rows: defs.map((d, i) => {
      const run: JobRun | null = runs[i] ?? null;
      const ok = run === null || run.status !== "failed";
      return {
        key: `reg-${d.def.key}`,
        group: d.group,
        name: d.def.label,
        cadence: cadenceLabel(d.parsed),
        nextText: formatNextRuns(nextCronRuns(d.parsed, 3)),
        enabled: true,
        running: run?.status === "running",
        lastRun: run === null ? null : { text: formatLastRun(run.startedAt, ok, null) ?? "—", ok },
        links: { logs: "/admin/data/run/?t=jobs" },
      };
    }),
    entries: defs.map((d) =>
      cronCal({
        key: `reg-${d.def.key}`,
        group: d.group,
        label: d.def.label,
        parsed: d.parsed,
        enabled: true,
      }),
    ),
  };
}

/** 计划全量(RSC 一次装配;组序 = 板面:资讯 → 热榜 → 社媒 → 发现 → 分析 → 维护) */
export async function buildPlanRows(): Promise<PlanBoardData> {
  const [rss, hot, social, registry] = await Promise.all([
    rssRows(),
    hotRows(),
    socialRows(),
    registryRows(),
  ]);
  const byGroup = (group: PlanGroup): PlanRow[] => registry.rows.filter((r) => r.group === group);
  return {
    rows: [
      ...rss.rows,
      ...hot.rows,
      ...social.rows,
      ...byGroup("discovery"),
      ...byGroup("analysis"),
      ...byGroup("maint"),
    ],
    calEntries: [...rss.entries, ...hot.entries, ...social.entries, ...registry.entries],
  };
}

// ── F19 脱期 / F20 即将运行 ───────────────────────────────────────────────────

/** jobKey → 期望运行间隔毫秒(登记表反向映射;crawler/ai-backfill 等非登记
 *  任务无固定节奏 → null,不参与脱期判定) */
export function registryIntervalMs(jobKey: string): number | null {
  const def = SCHEDULE_REGISTRY.find((d) => d.jobRunKey === jobKey);
  const parsed = def === undefined ? null : parseCron(def.cron);
  if (def === undefined || parsed === null || parsed.firesPerDay <= 0) return null;
  // 周任务 firesPerDay 是「触发日当日次数」,按触发天数摊回平均间隔(周档 = 7 天)
  const dayCount = parsed.days?.length ?? 7;
  return Math.round((86_400_000 * (7 / dayCount)) / parsed.firesPerDay);
}

/** 登记表全部 jobRun 键(F19 脱期判定需覆盖 7 日无运行的任务) */
export function registryJobRunKeys(): string[] {
  return SCHEDULE_REGISTRY.flatMap((d) => (d.jobRunKey ? [d.jobRunKey] : []));
}

/** F20 引擎卡「即将运行 · 未来 N 小时」:渠道/热榜/登记表的下一次触发,
 *  结构化时刻服务端预格式化(防水合漂移),按时刻升序。 */
export async function upcomingRuns(
  hours = 12,
  limit = 4,
): Promise<Array<{ key: string; label: string; atText: string }>> {
  const from = new Date();
  const horizon = from.getTime() + hours * 3_600_000;
  const candidates: Array<{ key: string; label: string; at: Date }> = [];
  const push = (key: string, label: string, at: Date | null | undefined): void => {
    if (
      at !== null &&
      at !== undefined &&
      at.getTime() > from.getTime() &&
      at.getTime() <= horizon
    ) {
      candidates.push({ key, label, at });
    }
  };
  const [channels, hot, parsed] = await Promise.all([
    listChannelsAdmin(),
    listHotSourcesAdmin(),
    parseCron(INSIGHT_FETCH_CRON),
  ]);
  for (const c of channels) {
    if (c.enabled)
      push(`rss-${c.id}`, c.name, nextIntervalRuns(c.nextRunAt, c.crawlIntervalMin, 1, from)[0]);
  }
  if (parsed !== null && hot.length > 0) {
    const at = nextCronRuns(parsed, 1, from)[0];
    if (at !== undefined) push("hot", `热榜拉取(${hot.length} 源)`, at);
  }
  for (const d of SCHEDULE_REGISTRY) {
    // 热榜拉取已在上面以「热榜拉取(N 源)」聚合;常驻高频(>8 次/日,F21 同口径)
    // 不进「即将运行」(embed-reconcile 类 tick)
    if (d.key === "insight-fetch") continue;
    const p = parseCron(d.cron);
    if (p === null || p.firesPerDay > CALENDAR_MAX_FIRES_PER_DAY) continue;
    push(`reg-${d.key}`, d.label, nextCronRuns(p, 1, from)[0]);
  }
  return candidates
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, limit)
    .map(({ key, label, at }) => ({
      key,
      label,
      atText: formatCnTime(at),
    }));
}
