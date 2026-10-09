/**
 * 订单状态查询 API(M21 批③,提案 §5.1 收银台轮询):本人或 admin;
 * 读库不触网关(实时性由回调 + 对账 job 保证),轮询限频交由前端 3s 下限。
 */
import { type NextRequest, NextResponse } from "next/server";

import { readSessionUser } from "@/lib/auth/session";
import { apiEnvelope } from "@/lib/http/response";
import { getOrderView } from "@/lib/pay/order-service";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderNo: string }> },
): Promise<NextResponse> {
  const session = await readSessionUser(req.headers.get("cookie"));
  if (!session) return apiEnvelope(401, "unauthorized");
  const { orderNo } = await params;
  if (!/^[A-Za-z0-9]{8,32}$/.test(orderNo)) return apiEnvelope(400, "invalid orderNo");

  const view = await getOrderView(orderNo, BigInt(session.sub), session.role === "admin");
  if (!view) return apiEnvelope(404, "订单不存在");
  return apiEnvelope(0, "ok", view);
}
