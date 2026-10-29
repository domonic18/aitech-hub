/**
 * PUT /api/pricing/sources/[key](M56 批B):渠道参数后台化——url/enabled 可调,
 * 即改即生效零发版(下次爬取按新值执行)。key 必须在代码侧注册表内(解析器
 * 住代码,DB 只存参数;未知 key 404)。url 校验 http(s);仅会话(PAT 拒绝)。
 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { SOURCE_DEFS } from "@/lib/pricing/source-registry";
import { formatZodIssues } from "@/lib/pricing/admin";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage pricing sources";

const patchSchema = z
  .object({
    url: z.string().trim().max(500).startsWith("http"),
    enabled: z.boolean(),
  })
  .partial();

export async function PUT(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { key } = await ctx.params;
  if (!SOURCE_DEFS.some((d) => d.key === key)) {
    return apiEnvelope(404, `渠道未注册: ${key}`);
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${formatZodIssues(parsed.error)}`);
  }
  if (Object.keys(parsed.data).length === 0) return apiEnvelope(400, "无可更新字段");
  const row = await prisma.pricingSource.update({
    where: { key },
    data: parsed.data,
    select: { key: true, url: true, enabled: true },
  });
  return apiEnvelope(0, "updated", { row });
}
