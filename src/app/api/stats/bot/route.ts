import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { classifyBotUa } from "@/lib/stats/bots";
import { classifyGeoSurface, GEO_UNKNOWN_AGENT } from "@/lib/stats/geo";
import { ingestBotFetch, ingestGeoFetch } from "@/lib/stats/service";

/**
 * 爬虫/GEO 抓取入账端点(2026-10-07 方案B;2026-10-09 方案A扩展,arch/05-services §5):
 * middleware waitUntil 打到此,再入 Redis 日缓冲(边缘运行时摸不到 redis)。
 * 信任模型与 beacon 一致:UA 由本端点按 x-original-ua 二次分类(不信任调用方
 * 声明的名字);body.path 可选(方案A GEO 面),服务端按 geo.ts 重分类形状、
 * 不信任原样字符串;未识别 UA 仅在 GEO 面入账(记 unknown-agent,长尾 Agent
 * 不可枚举),普通页面维持宁缺勿滥。伪造计数的影响面与伪造 beacon 相同,
 * 不新增信任面。mutation 类需同源校验(middleware 侧显式带 origin)。
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({ path: z.string().min(1).max(500).optional() });

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const bot = classifyBotUa(req.headers.get("x-original-ua"));
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  const rawPath = parsed.success ? (parsed.data.path ?? "") : "";
  const geo = rawPath === "" ? null : classifyGeoSurface(rawPath);
  if (!bot && !geo) return new NextResponse(null, { status: 204 }) as NextResponse;
  try {
    // 总账:命名爬虫的页面与 GEO 抓取都进 ref 日账(source_class='bot',方案B口径不变)
    if (bot) await ingestBotFetch(bot.name);
    // GEO 细分:任何 UA 都记,未识别记 unknown-agent(方案A决策点①)
    if (geo) await ingestGeoFetch(geo, bot?.name ?? GEO_UNKNOWN_AGENT, rawPath);
  } catch {
    // 统计尽力而为:redis 抖动时不重试不告警降噪(middleware 侧本就不等结果)
  }
  return new NextResponse(null, { status: 204 }) as NextResponse;
}
