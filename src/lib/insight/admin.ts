/**
 * 洞察中心后台读侧(M34 批①雏形→批②③ 演进,方案 §6):overview(总量/今日/
 * 日增序列/分源计数)+ listSignals(原始信号流)。批③ 渠道转向:全部读侧恒限
 * 在役源白名单(INSIGHT_SOURCES_ENABLED),站内搜索/agent/反馈存量行不再
 * 呈现;零结果搜索指标随源退出移除。
 * 簇视图(M47 批D 切出至 ./cluster-view,拆文件守 350 行线)与簇详情附加取数
 * (./cluster-extras)各自成文,此处留兼容出口。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { DAY_MS, cnDayKeyRange, startOfCnDay, statsDay } from "@/lib/datetime";

import { SIGNAL_PAGE_SIZE, SIGNAL_TAKE_DEFAULT, SIGNAL_TAKE_MAX } from "./constants";
import { INSIGHT_SOURCES_ENABLED, INSIGHT_SOURCE_MEDIUM, type InsightSource } from "./ingest";

// ── 兼容出口:既有调用方(页面/组件/测试)仍从 admin 取,实现住各自模块 ──
export {
  listInsightClusters,
  getInsightClusterDetail,
  type InsightClusterRow,
  type InsightClusterDetail,
} from "./cluster-view";

/** 在役源(批③ 渠道转向:站内搜索/agent/反馈退出,读侧全量按白名单过滤;
 * 存量行保留库中不再呈现) */
const ENABLED = [...INSIGHT_SOURCES_ENABLED];

export interface InsightSourceStat {
  source: string;
  medium: string;
  total: number;
  today: number;
}

export interface InsightOverview {
  total: number;
  today: number;
  /** 近 windowDays 日日增(含今日,缺日补 0,旧→新;北京日界) */
  daily: { date: string; count: number }[];
  bySource: InsightSourceStat[];
}

export interface InsightSignalRow {
  id: string;
  source: string;
  medium: string;
  lang: string | null;
  region: string | null;
  rawText: string;
  /** 中文译文(M58;非空时读侧默认展示,原文可切换) */
  translatedText: string | null;
  translationStatus: string;
  /** 原文链接(meta.url;无则 null)——信号页外链列,总览预览不渲染 */
  url: string | null;
  signalAt: string;
}

/** 总览(验收二批②:窗口参数化 7/30/90,读侧不动数据——信号/快照本就逐日
 * 累积,「每天重算」是固定窗口的读侧假象)。windowDays 夹取 1..90;
 * domain(M54 批C):领域视图过滤(undefined=全量,页侧把 "all" 解析为 undefined) */
export async function insightOverview(windowDays = 7, domain?: string): Promise<InsightOverview> {
  const window = Math.min(Math.max(Math.trunc(windowDays), 1), 90);
  const start = startOfCnDay();
  const since = new Date(start.getTime() - (window - 1) * DAY_MS);
  const domainWhere = domain === undefined ? {} : { domain };
  const domainSql = domain === undefined ? Prisma.empty : Prisma.sql` AND domain = ${domain}`;

  const [total, today, totals, todays, dailyRows] = await Promise.all([
    prisma.insightSignal.count({ where: { source: { in: ENABLED }, ...domainWhere } }),
    prisma.insightSignal.count({
      where: { source: { in: ENABLED }, signalAt: { gte: start }, ...domainWhere },
    }),
    prisma.insightSignal.groupBy({
      by: ["source"],
      where: { source: { in: ENABLED }, ...domainWhere },
      _count: { _all: true },
    }),
    prisma.insightSignal.groupBy({
      by: ["source"],
      where: { source: { in: ENABLED }, signalAt: { gte: start }, ...domainWhere },
      _count: { _all: true },
    }),
    prisma.$queryRaw<{ d: string; c: bigint }[]>`
      SELECT to_char(signal_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS d, count(*) AS c
      FROM insight_signal
      WHERE signal_at >= ${since} AND source IN (${Prisma.join(ENABLED)})${domainSql}
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  // 缺日补 0:键=北京日(SQL 显式 AT TIME ZONE 切桶,与 trend-series.ts 同口径;
  // 曾用 UTC date_trunc → 日界错 8 小时,今日 8 点后信号落出序列尾部)
  const countByDay = new Map(dailyRows.map((r) => [r.d, Number(r.c)]));
  const daily = cnDayKeyRange(statsDay(since), window, "fwd").map((date) => ({
    date,
    count: countByDay.get(date) ?? 0,
  }));

  const todayBySource = new Map(todays.map((r) => [r.source, r._count._all]));
  const bySource: InsightSourceStat[] = totals
    .map((r) => ({
      source: r.source,
      medium: INSIGHT_SOURCE_MEDIUM[r.source as InsightSource] ?? "",
      total: r._count._all,
      today: todayBySource.get(r.source) ?? 0,
    }))
    .sort((a, b) => b.total - a.total);

  return { total, today, daily, bySource };
}

const SIGNAL_SELECT = {
  id: true,
  source: true,
  medium: true,
  lang: true,
  region: true,
  rawText: true,
  translatedText: true,
  translationStatus: true,
  signalAt: true,
  // 原文链接在 meta.url(热榜/社区/厂商三处写入;无 url 列),信号页外链靠它
  meta: true,
} as const;

/** 信号查询筛选维度(source/medium/region 已由页侧钳制,此处只拼条件) */
export interface SignalQuery {
  source?: InsightSource;
  medium?: string;
  domain?: string;
  /** 地域筛选(M58 批①:cn=国内 / global=海外) */
  region?: string;
  from?: Date;
  to?: Date;
}

/** 信号 where 唯一出口(在役源白名单 + 各维筛选;列表/分页/计数/分组三查共用) */
function buildSignalWhere(opts: SignalQuery): Prisma.InsightSignalWhereInput {
  return {
    AND: [
      { source: { in: ENABLED } },
      ...(opts.source === undefined ? [] : [{ source: opts.source }]),
      ...(opts.medium === undefined ? [] : [{ medium: opts.medium }]),
      ...(opts.domain === undefined ? [] : [{ domain: opts.domain }]),
      ...(opts.region === undefined ? [] : [{ region: opts.region }]),
      ...(opts.from === undefined && opts.to === undefined
        ? []
        : [
            {
              signalAt: {
                ...(opts.from === undefined ? {} : { gte: opts.from }),
                ...(opts.to === undefined ? {} : { lt: opts.to }),
              },
            },
          ]),
    ],
  };
}

/** meta.url 取原文链接(仅接受 http(s),挡住 javascript:/data: 等外链注入;
 * 非字符串/空串/非法协议兜底 null;纯函数便于单测) */
export function pickSignalUrl(meta: Prisma.JsonValue | null): string | null {
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return null;
  const url = (meta as Record<string, unknown>).url;
  return typeof url === "string" && /^https?:\/\//i.test(url) ? url : null;
}

function mapSignalRow(r: {
  id: bigint;
  source: string;
  medium: string;
  lang: string | null;
  region: string | null;
  rawText: string;
  translatedText: string | null;
  translationStatus: string;
  signalAt: Date;
  meta: Prisma.JsonValue | null;
}): InsightSignalRow {
  return {
    id: r.id.toString(),
    source: r.source,
    medium: r.medium,
    lang: r.lang,
    region: r.region,
    rawText: r.rawText,
    translatedText: r.translatedText,
    translationStatus: r.translationStatus,
    url: pickSignalUrl(r.meta),
    signalAt: r.signalAt.toISOString(),
  };
}

/** 最近信号流(可按源/领域/地域过滤,恒限在役源);from/to 钳 signal_at(北京日界由
 * 调用方折算);limit 上限 200 */
export async function listInsightSignals(
  opts: SignalQuery & { limit?: number },
): Promise<InsightSignalRow[]> {
  const rows = await prisma.insightSignal.findMany({
    where: buildSignalWhere(opts),
    orderBy: { signalAt: "desc" },
    take: Math.min(Math.max(opts.limit ?? SIGNAL_TAKE_DEFAULT, 1), SIGNAL_TAKE_MAX),
    select: SIGNAL_SELECT,
  });
  return rows.map(mapSignalRow);
}

export interface InsightSignalPage {
  rows: InsightSignalRow[];
  total: number;
  page: number;
  pages: number;
  /** 同筛选条件下的分源条数(源 chips 计数;在役源序由页侧白名单定) */
  bySource: { source: string; count: number }[];
}

/** 信号独立页取数(M59 批A):分页列表 + 总数 + 分源计数,三查并行。
 * 分源计数刻意不套当前 source 筛选 —— 源 chips 要展示「切过去有多少条」,
 * 套上只会剩当前源一组(其余维度仍生效,chips 计数随地域/介质/日期联动)。 */
export async function listInsightSignalsPage(
  opts: SignalQuery & { page?: number; pageSize?: number },
): Promise<InsightSignalPage> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? SIGNAL_PAGE_SIZE, 1), SIGNAL_TAKE_MAX);
  const page = Math.max(1, opts.page ?? 1);
  const where = buildSignalWhere(opts);
  const chipWhere = buildSignalWhere({ ...opts, source: undefined });
  const [rows, total, groups] = await Promise.all([
    prisma.insightSignal.findMany({
      where,
      orderBy: [{ signalAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: SIGNAL_SELECT,
    }),
    prisma.insightSignal.count({ where }),
    prisma.insightSignal.groupBy({ by: ["source"], where: chipWhere, _count: { _all: true } }),
  ]);
  return {
    rows: rows.map(mapSignalRow),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    bySource: groups.map((g) => ({ source: g.source, count: g._count._all })),
  };
}

/** 实体详情「相关信号」(M59 批B):按 meta.entityKey 精确匹配——仅厂商抽取链
 * 写入该 meta 键(extract.ts),社区/热榜信号暂无实体挂接;恒限在役源 */
export async function listSignalsByEntityKey(
  entityKey: string,
  limit = SIGNAL_TAKE_DEFAULT,
): Promise<InsightSignalRow[]> {
  const rows = await prisma.insightSignal.findMany({
    where: {
      AND: [{ source: { in: ENABLED } }, { meta: { path: ["entityKey"], equals: entityKey } }],
    },
    orderBy: [{ signalAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(limit, 1), SIGNAL_TAKE_MAX),
    select: SIGNAL_SELECT,
  });
  return rows.map(mapSignalRow);
}

/** 关键词云 KPI:近 7 天候选增量 / 转正确认数(组件层裸 Prisma 下沉,M48 批F) */
export async function discoveryKeyword7dCounts(): Promise<{
  candidates7d: number;
  confirmed7d: number;
}> {
  const since7d = new Date(Date.now() - 7 * DAY_MS);
  const [candidates7d, confirmed7d] = await Promise.all([
    prisma.discoveryKeyword.count({ where: { createdAt: { gte: since7d } } }),
    prisma.discoveryKeyword.count({ where: { confirmedAt: { gte: since7d } } }),
  ]);
  return { candidates7d, confirmed7d };
}
