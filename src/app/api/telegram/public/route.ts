/**
 * 电报流公开 feed(M7 批⑤;M8 加 media;M10 加 offset 滚动加载):
 * 前台轮询端点(visible only,no-store)。静态段 public 优先于 [id] 动态段匹配;
 * limit 1-50,offset 0-500,source 可选,media 可选,after 增量。
 * band=1 走首页带形态:首页(默认 offset=0)混排 + 最新视频保底槽位,与 SSR
 * 同源 listBandFeed;offset>0 的后续页直接混排(保底槽位只属首页,客户端 id 去重)。
 */
import { type NextRequest, NextResponse } from "next/server";

import {
  PUBLIC_FEED_MAX_OFFSET,
  PUBLIC_FEED_PAGE_SIZE,
  countTodayVisible,
  listBandFeed,
  listPublicTelegram,
} from "@/lib/telegram/public-feed";
import { FEED_MEDIA_FILTERS, type FeedMediaFilter } from "@/lib/telegram/feed-view";

export const dynamic = "force-dynamic";

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
  // band=1:首页带形态(混排 + 视频保底),source/media/after 忽略,与 SSR 同源
  const items =
    sp.get("band") === "1"
      ? offset === 0
        ? await listBandFeed({ limit })
        : await listPublicTelegram({ limit, offset, media: "all" })
      : await listPublicTelegram({
          limit,
          offset,
          sourceId: sourceRaw && /^\d{1,10}$/.test(sourceRaw) ? Number(sourceRaw) : undefined,
          afterIso: sp.get("after") ?? undefined,
          media,
        });
  const today = await countTodayVisible();
  return NextResponse.json(
    { code: 0, message: "ok", data: { items, today } },
    { headers: { "cache-control": "no-store" } },
  );
}
