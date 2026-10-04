/**
 * 博主台账管理(M8 批③,arch/02 §3.2):social_account 列表/登记/编辑/启停/
 * 手动采集/删除。平台行与 Cookie 池/网关健康在 social-platform-admin.ts;
 * Cookie 展示永远脱敏,日志禁打 cookie 值。
 */
import { z } from "zod";

import { prisma } from "../db";
import { logger } from "../logger";
import { getQueue, QUEUE_CRAWLER } from "../queue";
import { SOCIAL_CRAWL_INTERVAL_MIN, VIDEO_PLATFORM_DOUYIN } from "./constants";
import { fetchDouyinProfile, resolveDouyinSecUid } from "./adapters/video/douyin";
import { BloggerAdminError, type BloggerAdminErrorCode } from "./bloggers-errors";
import { activeJars, ensurePlatformRow } from "./social-platform-admin";

export { BloggerAdminError, type BloggerAdminErrorCode } from "./bloggers-errors";

/** 抖音 sec_uid 形态(与网关 SEC_UID_PATTERN 同口径) */
const SEC_UID_PATTERN = /MS4wLjABAAAA[A-Za-z0-9_-]{20,}/;

// ── 台账 ──────────────────────────────────────────────────────────────────────

/** 台账列表(博主个位数量级,不分页) */
export async function listBloggersAdmin() {
  const rows = await prisma.socialAccount.findMany({
    orderBy: { id: "asc" },
    include: { platformRow: { select: { enabled: true } } },
  });
  return rows.map((b) => ({
    id: b.id,
    platform: b.platform,
    secUid: b.secUid,
    nickname: b.nickname,
    avatarUrl: b.avatarUrl,
    category: b.category,
    enabled: b.enabled,
    platformEnabled: b.platformRow.enabled,
    crawlIntervalMin: b.crawlIntervalMin,
    lastPostAt: b.lastPostAt,
    lastRunAt: b.lastRunAt,
    nextRunAt: b.nextRunAt,
    consecutiveFails: b.consecutiveFails,
    lastError: b.lastError,
    remark: b.remark,
    createdAt: b.createdAt,
  }));
}
export type BloggerRow = Awaited<ReturnType<typeof listBloggersAdmin>>[number];

// ── 登记与编辑 ────────────────────────────────────────────────────────────────

/** 登记:input=主页链接/分享口令/裸 sec_uid;nickname 手填兜底(网关不可达降级路径) */
export const BloggerCreateSchema = z.object({
  input: z.string().trim().min(1).max(500),
  nickname: z.string().trim().max(100).optional(),
  category: z.string().trim().max(50).nullable().optional(),
  crawlIntervalMin: z.number().int().min(SOCIAL_CRAWL_INTERVAL_MIN).max(1440).optional(),
  remark: z.string().trim().max(200).nullable().optional(),
});

export const BloggerUpdateSchema = z.object({
  nickname: z.string().trim().min(1).max(100),
  category: z.string().trim().max(50).nullable().optional(),
  crawlIntervalMin: z.number().int().min(SOCIAL_CRAWL_INTERVAL_MIN).max(1440),
  remark: z.string().trim().max(200).nullable().optional(),
});

function extractSecUid(input: string): string | null {
  return input.match(SEC_UID_PATTERN)?.[0] ?? null;
}

export async function createBlogger(
  raw: z.infer<typeof BloggerCreateSchema>,
): Promise<{ id: number }> {
  // 链接 → sec_uid:裸 sec_uid 直用,否则必须经网关 /resolve
  let secUid = extractSecUid(raw.input);
  if (!secUid) {
    try {
      secUid = await resolveDouyinSecUid(raw.input);
    } catch (err) {
      throw new BloggerAdminError(
        "gateway",
        `无法解析主页链接(网关不可达或链接无效),请直接粘贴博主主页 URL 中的 sec_uid:${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 昵称/头像:网关 /profile 自动拉;不可达时手填兜底(e2e 与降级路径)
  let nickname = raw.nickname ?? "";
  let avatarUrl: string | null = null;
  try {
    const profile = await fetchDouyinProfile(secUid, await activeJars(VIDEO_PLATFORM_DOUYIN));
    nickname = raw.nickname || profile.nickname;
    avatarUrl = profile.avatarUrl;
  } catch (err) {
    if (!nickname) {
      throw new BloggerAdminError(
        "gateway",
        `无法拉取博主信息(网关不可达),请手填昵称兜底:${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const platformRow = await ensurePlatformRow(VIDEO_PLATFORM_DOUYIN);
  try {
    const created = await prisma.socialAccount.create({
      data: {
        platformRowId: platformRow.id,
        platform: VIDEO_PLATFORM_DOUYIN,
        secUid,
        nickname,
        avatarUrl,
        category: raw.category ?? null,
        crawlIntervalMin: raw.crawlIntervalMin ?? SOCIAL_CRAWL_INTERVAL_MIN,
        remark: raw.remark ?? null,
      },
      select: { id: true },
    });
    logger.info({
      event: "blogger.created",
      bloggerId: created.id,
      platform: VIDEO_PLATFORM_DOUYIN,
      nickname,
    });
    return created;
  } catch (e) {
    if (isDuplicate(e)) throw new BloggerAdminError("duplicate", "该博主已登记(平台+sec_uid 重复)");
    throw e;
  }
}

function isDuplicate(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

export async function updateBlogger(
  id: number,
  raw: z.infer<typeof BloggerUpdateSchema>,
): Promise<{ id: number }> {
  const existing = await prisma.socialAccount.findUnique({ where: { id } });
  if (!existing) throw new BloggerAdminError("not_found", "博主不存在");
  const updated = await prisma.socialAccount.update({
    where: { id },
    data: {
      nickname: raw.nickname,
      category: raw.category ?? null,
      crawlIntervalMin: raw.crawlIntervalMin,
      remark: raw.remark ?? null,
    },
    select: { id: true },
  });
  logger.info({ event: "blogger.updated", bloggerId: id, nickname: raw.nickname });
  return updated;
}

export async function setBloggerEnabled(id: number, enabled: boolean): Promise<void> {
  const row = await prisma.socialAccount.findUnique({ where: { id }, select: { id: true } });
  if (!row) throw new BloggerAdminError("not_found", "博主不存在");
  await prisma.socialAccount.update({ where: { id }, data: { enabled } });
  logger.info({ event: "blogger.enabled_changed", bloggerId: id, enabled });
}

/** 两步武装删除:启用中 409;物理删(telegram.video_blogger 冗余已隔离,不级联) */
export async function deleteBlogger(id: number): Promise<void> {
  const row = await prisma.socialAccount.findUnique({
    where: { id },
    select: { id: true, enabled: true, nickname: true },
  });
  if (!row) throw new BloggerAdminError("not_found", "博主不存在");
  if (row.enabled) {
    throw new BloggerAdminError("enabled", "博主启用中,先停用再删除(两步武装删除)");
  }
  await prisma.socialAccount.delete({ where: { id } });
  logger.info({ event: "blogger.deleted", bloggerId: id, nickname: row.nickname });
}

/** 手动触发一轮采集(停用博主/平台总开关关闭均拒绝) */
export async function triggerBloggerCrawl(id: number): Promise<{ enqueued: true }> {
  const row = await prisma.socialAccount.findUnique({
    where: { id },
    select: {
      id: true,
      enabled: true,
      nickname: true,
      platformRow: { select: { enabled: true } },
    },
  });
  if (!row) throw new BloggerAdminError("not_found", "博主不存在");
  if (!row.enabled) throw new BloggerAdminError("disabled", "博主已停用,启用后再采集");
  if (!row.platformRow.enabled) throw new BloggerAdminError("disabled", "平台采集总开关已关闭");
  await getQueue(QUEUE_CRAWLER).add(
    "crawl-video",
    { accountId: row.id },
    {
      // 手动 job id 与调度 job(id 锚定 next_run_at)不冲突;入队即返回,结果看台账
      jobId: `crawl-video-${row.id}-manual-${Date.now()}`,
      removeOnComplete: 200,
      removeOnFail: 200,
    },
  );
  logger.info({ event: "blogger.crawl_triggered", bloggerId: row.id, nickname: row.nickname });
  return { enqueued: true };
}
