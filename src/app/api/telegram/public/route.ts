/**
 * 电报流公开 feed(M7 批⑤;M8 加 media;M10 加 offset 滚动加载):
 * 前台轮询端点(visible only,no-store)。静态段 public 优先于 [id] 动态段匹配;
 * limit 1-50,offset 0-500,source 可选,media 可选,after 增量(M15 批① 起锚
 * aiRanAt,且仅出 AI 解读终态行,见 public-feed.ts)。
 * band=1 走首页带形态:首页(默认 offset=0)混排 + 最新视频保底槽位,与 SSR
 * 同源 listBandFeed;offset>0 的后续页直接混排(保底槽位只属首页,客户端 id 去重)。
 * 2026-11-25 band=1 首屏加 45s 短缓存:首页 60s 轮询是本端点最大头(流量排查
 * 日均 4300 次),多访客共享一跳源查询;并发挂同一 in-flight,响应最多 45s
 * 陈旧(LIVE 带分钟级延迟容忍内),浏览器侧 no-store 保留轮询语义。
 */
import { type NextRequest, NextResponse } from "next/server";

import {
  PUBLIC_FEED_MAX_OFFSET,
  PUBLIC_FEED_PAGE_SIZE,
  countTodayVisible,
  listBandFeed,
  listPublicTelegram,
  type PublicTelegramItem,
} from "@/lib/telegram/public-feed";
import { FEED_MEDIA_FILTERS, type FeedMediaFilter } from "@/lib/telegram/feed-view";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

interface BandHomeSnapshot {
  items: PublicTelegramItem[];
  today: number;
  nextOffset: number;
}

interface BandHomeEntry {
  expiresAt: number;
  value?: BandHomeSnapshot;
  inflight?: Promise<BandHomeSnapshot>;
}

const BAND_HOME_TTL_MS = 45_000;
/** 键空间本应只有 limit 少数值;上限防 fuzz limit 打爆内存,满后新键直查不缓存 */
const BAND_HOME_MAX_KEYS = 16;
const bandHomeCache = new Map<string, BandHomeEntry>();

function bandHomeCached(limit: number): Promise<BandHomeSnapshot> {
  const key = `band:${limit}`;
  const entry = bandHomeCache.get(key);
  if (entry?.value && entry.expiresAt > Date.now()) return Promise.resolve(entry.value);
  if (entry?.inflight) return entry.inflight;
  const cacheable = bandHomeCache.has(key) || bandHomeCache.size < BAND_HOME_MAX_KEYS;
  const inflight = (async () => {
    const [band, today] = await Promise.all([listBandFeed({ limit }), countTodayVisible()]);
    const value: BandHomeSnapshot = { items: band.items, today, nextOffset: band.nextOffset };
    if (cacheable) {
      bandHomeCache.set(key, { expiresAt: Date.now() + BAND_HOME_TTL_MS, value });
    }
    return value;
  })();
  if (cacheable) {
    // 占位:并发请求挂同一 in-flight;完成后覆盖为带 value 的正式条目
    bandHomeCache.set(key, { expiresAt: 0, inflight });
  }
  return inflight;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const limitRaw = Number(sp.get("limit") ?? String(PUBLIC_FEED_PAGE_SIZE));
  const limit = Number.isFinite(limitRaw) ? limitRaw : PUBLIC_FEED_PAGE_SIZE;
  const offsetRaw = Number(sp.get("offset") ?? "0");
  const offset =
    Number.isInteger(offsetRaw) && offsetRaw > 0 ? Math.min(offsetRaw, PUBLIC_FEED_MAX_OFFSET) : 0;
  const sourceRaw = sp.get("source");
  const mediaRaw = sp.get("media") as FeedMediaFilter | null;
  const media = mediaRaw && FEED_MEDIA_FILTERS.includes(mediaRaw) ? mediaRaw : "all";
  // band=1:首页带形态(混排 + 视频保底),source/media/after 忽略,与 SSR 同源;
  // nextOffset = 服务端已消费的混排游标(首屏保底视频只占展示位不占游标)
  let items: PublicTelegramItem[];
  let nextOffset: number;
  let today: number;
  if (sp.get("band") === "1" && offset === 0) {
    const snap = await bandHomeCached(limit);
    items = snap.items;
    nextOffset = snap.nextOffset;
    today = snap.today;
  } else if (sp.get("band") === "1") {
    items = await listPublicTelegram({ limit, offset, media: "all" });
    nextOffset = offset + items.length;
    today = await countTodayVisible();
  } else {
    items = await listPublicTelegram({
      limit,
      offset,
      sourceId: sourceRaw && /^\d{1,10}$/.test(sourceRaw) ? Number(sourceRaw) : undefined,
      afterIso: sp.get("after") ?? undefined,
      media,
    });
    nextOffset = offset + items.length;
    today = await countTodayVisible();
  }
  return apiEnvelope(0, "ok", { items, today, nextOffset }, 200, {
    "cache-control": "no-store",
  });
}
