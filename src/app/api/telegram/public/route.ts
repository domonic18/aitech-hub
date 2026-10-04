/**
 * 电报流公开 feed(M7 批⑤):前台轮询端点(visible only,no-store)。
 * 静态段 public 优先于 [id] 动态段匹配;limit 1-50,source 可选,after 增量。
 */
import { type NextRequest, NextResponse } from "next/server";

import {
  PUBLIC_FEED_PAGE_SIZE,
  countTodayVisible,
  listPublicTelegram,
} from "@/lib/telegram/public-feed";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const limitRaw = Number(sp.get("limit") ?? String(PUBLIC_FEED_PAGE_SIZE));
  const sourceRaw = sp.get("source");
  const items = await listPublicTelegram({
    limit: Number.isFinite(limitRaw) ? limitRaw : PUBLIC_FEED_PAGE_SIZE,
    sourceId: sourceRaw && /^\d{1,10}$/.test(sourceRaw) ? Number(sourceRaw) : undefined,
    afterIso: sp.get("after") ?? undefined,
  });
  const today = await countTodayVisible();
  return NextResponse.json(
    { code: 0, message: "ok", data: { items, today } },
    { headers: { "cache-control": "no-store" } },
  );
}
