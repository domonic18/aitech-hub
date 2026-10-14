/**
 * 条目点击统计(M28 批①,requirement §3.5 扩展):首页/电报流条目点击行为。
 * 写侧 ingestClick:行级直插 stats_click_log 不经缓冲(循 stats_search_log
 * 先例,点击量级远小于 PV,零 flush 工程);域名在服务端从 target 解析,
 * 不信任客户端字段。读侧 getHotClicks/getClickDomains 仅供 admin 统计页
 * (读侧集中 queries.ts,本域读写同文件收口避免 queries.ts 再膨胀);
 * purgeClickLogs 挂 worker 日调度,180 天保留同搜索词。
 * 表无 PII(无 IP/无访客哈希);ref 无外键,标题查询侧反解,删除兜底占位。
 */
import { prisma } from "@/lib/db";
import { statsDay } from "@/lib/datetime";
import { logger } from "@/lib/logger";

export const CLICK_SURFACES = ["home", "telegram"] as const;
export const CLICK_KINDS = ["telegram", "project", "post"] as const;

export type ClickSurface = (typeof CLICK_SURFACES)[number];
export type ClickKind = (typeof CLICK_KINDS)[number];

export interface ClickInput {
  surface: ClickSurface;
  kind: ClickKind;
  /** 条目键:telegram/post=BigInt id 文本,project=slug(zod 层已收窄字符集) */
  ref: string;
  /** 条目目标(外链 URL 或站内路径);domain 由本侧解析 */
  target: string;
}

/** 外链域名解析:非 URL 形态(站内路径)返空串;hostname 截 100(表上限) */
export function domainOf(target: string): string {
  try {
    return new URL(target).hostname.slice(0, 100);
  } catch {
    return "";
  }
}

/** 单次点击入账;行级直插,失败仅告警(beacon 不重试,少计一次可接受) */
export function ingestClick(input: ClickInput): void {
  prisma.statsClickLog
    .create({
      data: {
        surface: input.surface,
        kind: input.kind,
        ref: input.ref,
        domain: domainOf(input.target),
      },
    })
    .catch((e: unknown) => logger.warn({ event: "stats.click_log.failed", error: String(e) }));
}

/** 点击明细保留天数(无 PII,与搜索词一致;「全部」窗口的实际上界) */
const CLICK_LOG_RETENTION_DAYS = 180;

/** 清理保留窗口外的点击明细;返回删除行数(0 不打日志) */
export async function purgeClickLogs(): Promise<number> {
  const cutoff = new Date(Date.now() - CLICK_LOG_RETENTION_DAYS * 86_400_000);
  const r = await prisma.statsClickLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return r.count;
}

// ── 读侧(admin 统计页「热门点击」)────────────────────────────────

export interface HotClickRow {
  kind: ClickKind;
  /** 条目键(同表 ref) */
  ref: string;
  /** 展示标题(telegram/post 按反查 title,project 按 fullName;删除兜底占位) */
  title: string;
  count: number;
}

/** 热门条目点击:kind+ref 聚合(跨 surface 合计——同一电报条目首页带与电报流
 * 页同源,分面计数对「哪条内容热」无增益;面别留表内可后续 SQL 细分) */
export async function getHotClicks(
  range: "today" | "7d" | "30d" | "all",
  limit = 10,
): Promise<HotClickRow[]> {
  const rows = await prisma.statsClickLog.groupBy({
    by: ["kind", "ref"],
    where:
      range === "all"
        ? undefined
        : {
            createdAt: {
              gte: cnDayStart(dayStr(range === "today" ? 0 : range === "7d" ? 6 : 29)),
            },
          },
    _count: { _all: true },
    orderBy: [{ _count: { ref: "desc" } }, { ref: "asc" }],
    take: limit,
  });
  if (rows.length === 0) return [];

  // 标题反解(kind 三路各自批量反查; BigInt id 文本 ↔ BigInt 转换失败行兜底占位)
  const idsOf = (kind: ClickKind): bigint[] =>
    rows
      .filter((r) => r.kind === kind)
      .map((r) => {
        try {
          return BigInt(r.ref);
        } catch {
          return null;
        }
      })
      .filter((v): v is bigint => v !== null);
  const [telegrams, posts, repos] = await Promise.all([
    idsOf("telegram").length
      ? prisma.telegram.findMany({
          where: { id: { in: idsOf("telegram") } },
          select: { id: true, title: true },
        })
      : [],
    idsOf("post").length
      ? prisma.post.findMany({
          where: { id: { in: idsOf("post") } },
          select: { id: true, title: true },
        })
      : [],
    rows.some((r) => r.kind === "project")
      ? prisma.githubRepo.findMany({
          where: { slug: { in: rows.filter((r) => r.kind === "project").map((r) => r.ref) } },
          select: { slug: true, fullName: true },
        })
      : [],
  ]);
  const tgTitle = new Map(telegrams.map((t) => [t.id.toString(), t.title]));
  const postTitle = new Map(posts.map((p) => [p.id.toString(), p.title]));
  const repoName = new Map(repos.map((r) => [r.slug, r.fullName]));

  return rows.map((r) => {
    const kind = r.kind as ClickKind;
    const title =
      kind === "telegram"
        ? (tgTitle.get(r.ref) ?? `电报条目 #${r.ref}`)
        : kind === "post"
          ? (postTitle.get(r.ref) ?? `文章 #${r.ref}`)
          : (repoName.get(r.ref) ?? r.ref);
    return { kind, ref: r.ref, title, count: r._count._all };
  });
}

export interface ClickDomainRow {
  domain: string;
  count: number;
}

/** 外链域名分布:仅外链(domain 非空;站内链接不入分母) */
export async function getClickDomains(
  range: "today" | "7d" | "30d" | "all",
  limit = 8,
): Promise<ClickDomainRow[]> {
  const rows = await prisma.statsClickLog.groupBy({
    by: ["domain"],
    where: {
      domain: { not: "" },
      ...(range === "all"
        ? {}
        : {
            createdAt: {
              gte: cnDayStart(dayStr(range === "today" ? 0 : range === "7d" ? 6 : 29)),
            },
          }),
    },
    _count: { _all: true },
    orderBy: [{ _count: { domain: "desc" } }, { domain: "asc" }],
    take: limit,
  });
  return rows.map((r) => ({ domain: r.domain, count: r._count._all }));
}

// ── 窗口工具(queries.ts 同款北京日界;两行小工具就地复制,读写同文件收口)──

function dayStr(offsetDays: number): string {
  return statsDay(new Date(Date.now() - offsetDays * 86_400_000));
}

function cnDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+08:00`);
}
