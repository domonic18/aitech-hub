/**
 * F21/F22 采集计划聚合:六业务分组(资讯 RSS/热榜/社媒/发现/分析/维护)的
 * PlanRow 列表行与 PlanCalEntry 日历条目。三类来源——文字渠道与热榜源(台账
 * 投影)、视频平台(博主聚合行,运行态经 crawler 队列活跃 job 反查)、cron
 * 登记表(SCHEDULE_REGISTRY,最近运行查 jobRun 末次落账)。时刻推导与文案在
 * ./plan-rows-types(客户端同源,本文件持 prisma/getQueue,不进浏览器包)。
 */
import type { JobRun } from "@prisma/client";

import { prisma } from "../db";
import {
  CRAWL_SOURCE_TYPE_SOCIAL_VIDEO,
  SOCIAL_CRAWL_INTERVAL_MIN,
  VIDEO_PLATFORM_LABELS,
} from "../telegram/constants";
import { listChannelsAdmin } from "../telegram/channels-admin";
import { listHotSourcesAdmin } from "../insight/hot-source";
import { INSIGHT_FETCH_CRON, parseCron, SCHEDULE_REGISTRY } from "./schedules";
import { intervalText } from "./channel-ledger-types";
import { videoRunningSince } from "./channel-ledger";
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

/** 登记表 key → jobRun jobKey(最近运行落账映射;embed-reconcile 准心跳不入账) */
const REGISTRY_JOB_RUN_KEY: Record<string, string> = {
  "db-backup": "db-backup/run",
  "media-audit": "media-audit/audit",
  "insight-daily": "insight/daily",
  "pay-daily-audit": "pay-reconcile/daily-audit",
  "visit-purge": "stats/purge-visit-log",
  "cover-sweep": "cover-gen/temp-sweep",
  "agent-purge": "stats/purge-agent-session",
  "job-run-purge": "stats/purge-job-run",
  "discovery-hotwords": "discovery/discovery-hotwords",
  "usage-purge": "stats/purge-usage-log",
  "insight-fetch": "insight/fetch",
  "discovery-bili": "discovery/discovery-bili",
  "insight-embed": "insight/embed",
};

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
      const jobKey = REGISTRY_JOB_RUN_KEY[d.def.key];
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
