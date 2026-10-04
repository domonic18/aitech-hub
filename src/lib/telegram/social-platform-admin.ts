/**
 * 视频平台级管理(M8 批③,arch/02 §2):平台行(crawl_source type=social-video)
 * 是 Cookie 池/总开关/日上限载体——本文件管平台行 upsert、Cookie 池导入/清空/
 * 脱敏视图与网关健康观测;博主个体 CRUD 在 bloggers-admin.ts。
 * Cookie 值 AES-256-GCM 密文落 config,展示只出脱敏 ttwid 前缀,日志禁打 cookie。
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { env } from "../env";
import { prisma } from "../db";
import { logger } from "../logger";
import { socialPlatformRowName, VIDEO_PLATFORMS } from "./constants";
import { decryptJars, encryptJars, CookiePoolError, maskJars, mergeImportedJar } from "./cookies";
import { BloggerAdminError } from "./bloggers-admin";

/** 平台行占位端点(url 为必填列;平台行自身不做 fetch,值仅语义占位) */
function platformRowUrl(platform: string): string {
  return `https://www.${platform}.com`;
}

/** 平台行 upsert(首次 Cookie 导入/首次登记博主时落地;enabled=平台总开关) */
export async function ensurePlatformRow(platform: string) {
  const name = socialPlatformRowName(platform);
  const existing = await prisma.crawlSource.findUnique({ where: { name } });
  if (existing) return existing;
  return prisma.crawlSource.create({
    data: {
      name,
      type: "social-video",
      platform,
      url: platformRowUrl(platform),
      crawlIntervalMin: 120,
      remark: "视频平台行:Cookie 池/总开关/日上限载体,自身不调度",
    },
  });
}

/** 池中可用明文 jar(采集编排与登记博主拉 profile 复用;空池返回 []) */
export async function activeJars(platform: string): Promise<string[]> {
  const row = await prisma.crawlSource.findUnique({
    where: { name: socialPlatformRowName(platform) },
    select: { config: true },
  });
  const config = row?.config as { cookieJars?: unknown } | null;
  return decryptJars(config?.cookieJars);
}

// ── Cookie 池 ─────────────────────────────────────────────────────────────────

export interface CookiePoolView {
  platform: string;
  enabled: boolean;
  jarCount: number;
  masked: Array<{ ttwidPrefix: string }>;
  dailyMaxRequests: number | null;
}

/** Cookie 池状态(页顶状态卡 + GET /api/bloggers/cookies):只出脱敏视图 */
export async function getCookiePoolView(): Promise<{ pools: CookiePoolView[] }> {
  const rows = await prisma.crawlSource.findMany({
    where: { type: "social-video" },
    orderBy: { id: "asc" },
  });
  return {
    pools: rows.map((r) => {
      const jars = decryptJars((r.config as { cookieJars?: unknown } | null)?.cookieJars);
      return {
        platform: r.platform ?? r.name,
        enabled: r.enabled,
        jarCount: jars.length,
        masked: maskJars(jars),
        dailyMaxRequests: r.dailyMaxRequests,
      };
    }),
  };
}

/** Cookie 导入校验(值不回显不落日志) */
export const CookieImportSchema = z.object({
  platform: z.enum(VIDEO_PLATFORMS),
  cookie: z.string().min(10).max(8000),
});

/** 导入一份 jar:校验(≥3 对且含 ttwid)→ 按 ttwid 去重并入 → AES 密文回写平台行 */
export async function importCookieJar(
  platform: string,
  cookie: string,
): Promise<{ jarCount: number }> {
  const row = await ensurePlatformRow(platform);
  const existing = decryptJars((row.config as { cookieJars?: unknown } | null)?.cookieJars);
  let merged: string[];
  try {
    merged = mergeImportedJar(existing, cookie);
  } catch (e) {
    if (e instanceof CookiePoolError) throw new BloggerAdminError("invalid", e.message);
    throw e;
  }
  const config = {
    ...((row.config as Record<string, unknown> | null) ?? {}),
    cookieJars: encryptJars(merged),
  };
  await prisma.crawlSource.update({
    where: { id: row.id },
    data: { config: config as Prisma.InputJsonValue },
  });
  logger.info({ event: "blogger.cookie_imported", platform, jarCount: merged.length });
  return { jarCount: merged.length };
}

/** 清空平台 Cookie 池(保留 config 其它键与平台行本身) */
export async function clearCookieJars(platform: string): Promise<void> {
  const row = await prisma.crawlSource.findUnique({
    where: { name: socialPlatformRowName(platform) },
    select: { id: true, config: true },
  });
  if (!row) throw new BloggerAdminError("not_found", "平台行不存在(尚无 Cookie 导入记录)");
  const config = clearJarsInConfig(row.config);
  await prisma.crawlSource.update({
    where: { id: row.id },
    data: { config: (config ?? Prisma.DbNull) as Prisma.InputJsonValue },
  });
  logger.info({ event: "blogger.cookie_cleared", platform });
}

function clearJarsInConfig(config: unknown): Record<string, unknown> | null {
  if (config == null || typeof config !== "object") return null;
  const out = { ...(config as Record<string, unknown>) };
  delete out.cookieJars;
  return out;
}

// ── 网关健康(RSC 状态卡) ─────────────────────────────────────────────────────

export interface GatewayHealthView {
  reachable: boolean;
  status?: string;
  jarsTotal?: number;
  jarsAvailable?: number;
}

/** 网关 /health 带短超时;不可达返回降级视图(不阻塞页面渲染) */
export async function fetchGatewayHealth(): Promise<GatewayHealthView> {
  try {
    const res = await fetch(`${env.DOUYIN_GATEWAY_URL}/health`, {
      signal: AbortSignal.timeout(3_000),
      cache: "no-store",
    });
    if (!res.ok) return { reachable: false };
    const body = (await res.json()) as {
      status?: string;
      jars_total?: number;
      jars_available?: number;
    };
    return {
      reachable: true,
      status: body.status,
      jarsTotal: body.jars_total,
      jarsAvailable: body.jars_available,
    };
  } catch {
    return { reachable: false };
  }
}
