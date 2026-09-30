/**
 * 旧 URL 承接(arch/07-frontend §6):legacy_url_map 查表 + Redis 1h 缓存(含负缓存防穿透)。
 * 两条消费路径:/(site)/legacy/[...path] 路由(prod Nginx 兜底转发),以及
 * /[slug]、/category/[slug]、/tag/[slug] 页面未命中文章时的同进程兜底
 * ("先新站路由、后映射表")。纯决策见 legacy-decide.ts(单测)。
 */
import { notFound, permanentRedirect } from "next/navigation";

import { LEGACY_CACHE_TTL_SECONDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { buildLegacyPath, decideLegacy, type LegacyHit, type LegacyLookup } from "./legacy-decide";

export { buildLegacyPath, decideLegacy } from "./legacy-decide";
export type { LegacyHit, LegacyLookup } from "./legacy-decide";

/** 完整旧路径(以 / 包裹)查映射;Redis 值 "-" 记负缓存 */
export async function lookupLegacyPath(oldPath: string): Promise<LegacyLookup> {
  const key = `legacy:map:${oldPath}`;
  const cached = await redis.get(key).catch(() => null);
  if (cached !== null) {
    return cached === "-" ? "miss" : (JSON.parse(cached) as LegacyLookup);
  }
  const row = await prisma.legacyUrlMap.findUnique({
    where: { oldPath },
    select: { targetUrl: true, httpStatus: true },
  });
  const value: LegacyLookup = row
    ? { targetUrl: row.targetUrl, httpStatus: row.httpStatus }
    : "miss";
  await redis
    .set(key, value === "miss" ? "-" : JSON.stringify(value), "EX", LEGACY_CACHE_TTL_SECONDS)
    .catch(() => undefined);
  return value;
}

/**
 * 页面兜底([slug] 等查无内容时调用):命中 → 永久重定向;
 * 弃用(target NULL)或未命中 → 404。
 * RSC 页面语境拿不到 301(permanentRedirect 固定 308,同为永久类);
 * 表内 httpStatus 的精确表达由 /legacy/[...path] 路由层完成,两者共用同一张映射表。
 */
export async function legacyRedirectOrNotFound(segments: string[]): Promise<never> {
  const lookup = await lookupLegacyPath(buildLegacyPath(segments));
  if (decideLegacy(lookup) === "redirect") {
    permanentRedirect((lookup as LegacyHit).targetUrl as string);
  }
  notFound();
}
