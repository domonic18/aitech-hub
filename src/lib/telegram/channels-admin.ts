/**
 * 渠道台账管理(M7 批④,arch/02 §2):crawl_source 列表/新建/编辑/启停/手动采集。
 * 凭证纪律(2026-10-03 用户定):渠道凭证一律存 config JSONB,不经环境变量;
 * 读侧一律脱敏(maskConfig/maskUrlSecrets),写侧 token undefined 沿用、空串清除;
 * 日志只记事件与渠道名,禁打凭证值。
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";

import { isP2002, prisma } from "../db";
import { logger } from "../logger";
import { getQueue, QUEUE_CRAWLER } from "../queue";
import { fetchSourceItems } from "./adapters";
import {
  CRAWL_SOURCE_STATUS_HEALTHY,
  CRAWL_SOURCE_TYPE_SOCIAL_VIDEO,
  CRAWL_SOURCE_TYPES,
} from "./constants";

/** 视为凭证的 config 键(读侧脱敏 + 写侧空串清除) */
export const SECRET_CONFIG_KEYS = ["token", "apiKey", "api_key", "secret"] as const;

const SECRET_KEY_SET = new Set<string>(SECRET_CONFIG_KEYS);

export function maskSecret(value: string): string {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

/** config 读侧投影:凭证键脱敏,其余键字符串化;非对象返回 null */
export function maskConfig(config: unknown): Record<string, string> | null {
  if (config == null || typeof config !== "object") return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(config as Record<string, unknown>)) {
    out[k] = SECRET_KEY_SET.has(k) && typeof v === "string" ? maskSecret(v) : String(v ?? "");
  }
  return out;
}

/** URL 展示防御:query 里凭证键的值替换 ****(防把带 token 的完整 URL 粘进端点字段) */
export function maskUrlSecrets(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  let changed = false;
  for (const k of [...u.searchParams.keys()]) {
    if (SECRET_KEY_SET.has(k.toLowerCase())) {
      u.searchParams.set(k, "****");
      changed = true;
    }
  }
  return changed ? u.toString() : raw;
}

export type ChannelAdminErrorCode = "not_found" | "name_taken" | "disabled";

/** 业务错误 → 路由按码映射 HTTP 状态(同 UserAdminError 模式) */
export class ChannelAdminError extends Error {
  constructor(
    public code: ChannelAdminErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** 渠道表单(创建/编辑共用;token 为凭证写侧,不入库明文日志) */
export const ChannelInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(CRAWL_SOURCE_TYPES),
  platform: z.string().trim().max(20).nullable().optional(),
  url: z.url().max(500),
  crawlIntervalMin: z.number().int().min(5).max(1440),
  dailyMaxRequests: z.number().int().min(1).max(10000).nullable().optional(),
  remark: z.string().trim().max(200).nullable().optional(),
  enabled: z.boolean().optional(),
  token: z.string().max(200).optional(),
});
export type ChannelInput = z.infer<typeof ChannelInputSchema>;

/** 台账列表(渠道个位数量级,不分页);端点与凭证均脱敏后出service。
 * 平台行(type=social-video)是 Cookie 池载体非采集渠道,不进文字台账(arch/02 §5)。
 * 2026-10-06 验收反馈问题3:补 24h 入流条数(原型「24h 条数」列)。 */
export async function listChannelsAdmin() {
  const [rows, counts] = await Promise.all([
    prisma.crawlSource.findMany({
      where: { type: { not: CRAWL_SOURCE_TYPE_SOCIAL_VIDEO } },
      orderBy: { id: "asc" },
    }),
    prisma.telegram.groupBy({
      by: ["sourceId"],
      where: { createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } },
      _count: { _all: true },
    }),
  ]);
  const count24h = new Map(counts.map((g) => [g.sourceId, g._count._all]));
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    platform: c.platform,
    url: maskUrlSecrets(c.url),
    enabled: c.enabled,
    crawlIntervalMin: c.crawlIntervalMin,
    dailyMaxRequests: c.dailyMaxRequests,
    consecutiveFails: c.consecutiveFails,
    lastRunAt: c.lastRunAt,
    nextRunAt: c.nextRunAt,
    status: c.status,
    remark: c.remark,
    maskedConfig: maskConfig(c.config),
    count24h: count24h.get(c.id) ?? 0,
    createdAt: c.createdAt,
  }));
}
export type ChannelRow = Awaited<ReturnType<typeof listChannelsAdmin>>[number];

/** config 写侧合并:undefined 沿用;空串仅清凭证键保留其它;非空覆盖 */
function mergeConfig(existing: unknown, token: string | undefined): Record<string, unknown> | null {
  if (token === undefined) return null;
  const base =
    typeof existing === "object" && existing !== null
      ? { ...(existing as Record<string, unknown>) }
      : {};
  if (token === "") {
    for (const k of SECRET_CONFIG_KEYS) delete base[k];
    return base;
  }
  return { ...base, token };
}

export async function createChannel(input: ChannelInput): Promise<{ id: number }> {
  const { token, ...data } = input;
  const config = mergeConfig(null, token);
  try {
    const created = await prisma.crawlSource.create({
      data: {
        name: data.name,
        type: data.type,
        platform: data.platform ?? null,
        url: data.url,
        crawlIntervalMin: data.crawlIntervalMin,
        dailyMaxRequests: data.dailyMaxRequests ?? null,
        remark: data.remark ?? null,
        enabled: input.enabled ?? true,
        config: config ? (config as Prisma.InputJsonValue) : undefined,
      },
      select: { id: true },
    });
    logger.info({
      event: "channel.created",
      channelId: created.id,
      name: data.name,
      type: data.type,
    });
    return created;
  } catch (e) {
    if (isP2002(e)) throw new ChannelAdminError("name_taken", "渠道名已存在");
    throw e;
  }
}

export async function updateChannel(id: number, input: ChannelInput): Promise<{ id: number }> {
  const existing = await prisma.crawlSource.findUnique({ where: { id } });
  if (!existing) throw new ChannelAdminError("not_found", "渠道不存在");
  const { token, ...data } = input;
  // 换端点/换类型不继承旧失败计数(新目标从健康起步)
  const targetChanged = data.url !== existing.url || data.type !== existing.type;
  const config = mergeConfig(existing.config, token);
  const updated = await prisma.crawlSource.update({
    where: { id },
    data: {
      name: data.name,
      type: data.type,
      platform: data.platform ?? null,
      url: data.url,
      crawlIntervalMin: data.crawlIntervalMin,
      dailyMaxRequests: data.dailyMaxRequests ?? null,
      remark: data.remark ?? null,
      enabled: input.enabled ?? existing.enabled,
      ...(config ? { config: config as Prisma.InputJsonValue } : {}),
      ...(targetChanged ? { consecutiveFails: 0, status: CRAWL_SOURCE_STATUS_HEALTHY } : {}),
    },
    select: { id: true },
  });
  logger.info({ event: "channel.updated", channelId: id, name: data.name, targetChanged });
  return updated;
}

export async function setChannelEnabled(id: number, enabled: boolean): Promise<void> {
  const src = await prisma.crawlSource.findUnique({ where: { id }, select: { id: true } });
  if (!src) throw new ChannelAdminError("not_found", "渠道不存在");
  await prisma.crawlSource.update({ where: { id }, data: { enabled } });
  logger.info({ event: "channel.enabled_changed", channelId: id, enabled });
}

/** 手动触发一轮采集(队列入队,复用 crawl job;停用渠道拒绝) */
export async function triggerChannelCrawl(id: number): Promise<{ enqueued: true }> {
  const src = await prisma.crawlSource.findUnique({
    where: { id },
    select: { id: true, enabled: true, name: true },
  });
  if (!src) throw new ChannelAdminError("not_found", "渠道不存在");
  if (!src.enabled) throw new ChannelAdminError("disabled", "渠道已停用,启用后再采集");
  await getQueue(QUEUE_CRAWLER).add(
    "crawl",
    { sourceId: src.id, sourceName: src.name },
    {
      // 手动 job id 与调度 job(id 锚定 next_run_at)不冲突;入队即返回,结果看台账
      jobId: `crawl-${src.id}-manual-${Date.now()}`,
      removeOnComplete: 200,
      removeOnFail: 200,
    },
  );
  logger.info({ event: "channel.crawl_triggered", channelId: src.id, name: src.name });
  return { enqueued: true };
}

export interface ChannelDebugResult {
  ok: boolean;
  elapsedMs: number;
  items: Array<{ title: string; url: string; publishedAt: string | null }>;
  error?: string;
}

/** 渠道调试(原型「调试」:拉取最新 3 条 + 耗时;2026-10-06 验收反馈问题3):
 * 直接走采集适配器取数,不入库、不动健康度与调度状态;凭证照常从 config 注入。
 * web/api 类型适配器未实现(fetchSourceItems 显式抛错),如实返回错误不假装成功。 */
export async function debugChannel(id: number): Promise<ChannelDebugResult> {
  const src = await prisma.crawlSource.findUnique({ where: { id } });
  if (!src) throw new ChannelAdminError("not_found", "渠道不存在");
  const started = Date.now();
  try {
    const items = await fetchSourceItems(src.type, src.url, src.config);
    logger.info({ event: "channel.debugged", channelId: src.id, name: src.name, ok: true });
    return {
      ok: true,
      elapsedMs: Date.now() - started,
      items: items.slice(0, 3).map((i) => ({
        title: i.title,
        url: i.url,
        publishedAt: i.publishedAt?.toISOString() ?? null,
      })),
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.info({ event: "channel.debugged", channelId: src.id, name: src.name, ok: false });
    return { ok: false, elapsedMs: Date.now() - started, items: [], error };
  }
}
