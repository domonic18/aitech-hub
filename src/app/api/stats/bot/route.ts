import { type NextRequest, NextResponse } from "next/server";

import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { classifyBotUa } from "@/lib/stats/bots";
import { ingestBotFetch } from "@/lib/stats/service";

/**
 * 爬虫抓取入账端点(2026-10-07 方案B,arch/05-services §5):middleware 识别
 * 已命名爬虫后 waitUntil 打到此,再入 Redis 日缓冲(边缘运行时摸不到 redis)。
 * 信任模型与 beacon 一致:UA 由本端点按 x-original-ua 二次分类(不信任调用方
 * 声明的名字),未识别 UA 直接 204 不入账;伪造计数的影响面与伪造 beacon 相同,
 * 不新增信任面。mutation 类需同源校验(middleware 侧显式带 origin)。
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const bot = classifyBotUa(req.headers.get("x-original-ua"));
  if (!bot) return new NextResponse(null, { status: 204 }) as NextResponse;
  try {
    await ingestBotFetch(bot.name);
  } catch {
    // 统计尽力而为:redis 抖动时不重试不告警降噪(middleware 侧本就不等结果)
  }
  return new NextResponse(null, { status: 204 }) as NextResponse;
}
