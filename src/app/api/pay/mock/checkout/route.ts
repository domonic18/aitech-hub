/**
 * Mock 模拟支付 API(M21 批③,仅 mode=mock 可用):本地/开发收银台无真实
 * 网关回调,由本端点以服务端 MOCK_SECRET 构造合法签名回调并走与线上一致
 * 的 handleNotify 链路,完成「下单→回调→发货→门禁」全流程联调。生产环境
 * 三重护栏之运行时侧:gateway_off 时 404,任何环境都不可凭它动真单。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { readSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { getPayGateway } from "@/lib/pay/gateway";
import { buildMockNotify } from "@/lib/pay/gateway/mock";
import { handleNotify } from "@/lib/pay/order-service";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ orderNo: z.string().regex(/^[A-Za-z0-9]{8,32}$/) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const session = await readSessionUser(req.headers.get("cookie"));
  if (!session) return apiEnvelope(401, "unauthorized");

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "invalid body");

  const gateway = await getPayGateway();
  if (gateway?.name !== "mock") return apiEnvelope(404, "not found");

  // 仅本人可模拟支付自己的订单(防探测他人单号状态)
  const order = await prisma.payOrder.findUnique({
    where: { orderNo: parsed.data.orderNo },
    select: { userId: true, amount: true },
  });
  if (!order || order.userId !== BigInt(session.sub)) return apiEnvelope(404, "订单不存在");

  const payload = buildMockNotify(parsed.data.orderNo, order.amount.toFixed(2));
  const { ok } = await handleNotify(gateway.verifyNotify(payload), payload);
  return ok ? apiEnvelope(0, "paid") : apiEnvelope(400, "模拟支付被拒");
}
