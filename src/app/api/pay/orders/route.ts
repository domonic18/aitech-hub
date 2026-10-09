/**
 * 下单 API(M21 批③,提案 §5.1):POST { postId } → 复用/创建 pending 单
 * + 网关取收银链。登录必需(游客由前端引导 D1);金额取服务端定价,客户端
 * 不可传价;下单限频(session 10/时 + IP 30/时,安全清单 #8)。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isOverLimit, recordHit } from "@/lib/auth/rate-limit";
import { readSessionUser } from "@/lib/auth/session";
import { clientIp } from "@/lib/http/request";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { PayError, createOrReuseOrder } from "@/lib/pay/order-service";

export const dynamic = "force-dynamic";

const CreateOrderSchema = z.object({
  postId: z.coerce.bigint().positive(),
});

const USER_LIMIT = 10;
const IP_LIMIT = 30;
const WINDOW_SECONDS = 3600;

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const session = await readSessionUser(req.headers.get("cookie"));
  if (!session) return apiEnvelope(401, "请先登录后解锁");

  const parsed = CreateOrderSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "invalid body");

  const userBucket = `pay:order:u:${session.sub}`;
  const ip = clientIp(req);
  const ipBucket = `pay:order:ip:${ip}`;
  if (
    (await isOverLimit(userBucket, USER_LIMIT)) ||
    (ip && (await isOverLimit(ipBucket, IP_LIMIT)))
  ) {
    return apiEnvelope(429, "下单过于频繁,请稍后再试");
  }
  await recordHit(userBucket, WINDOW_SECONDS);
  if (ip) await recordHit(ipBucket, WINDOW_SECONDS);

  try {
    const result = await createOrReuseOrder({
      userId: BigInt(session.sub),
      postId: parsed.data.postId,
      clientIp: ip,
    });
    return apiEnvelope(0, "ok", {
      orderNo: result.orderNo,
      payUrl: result.payUrl,
      amount: result.amount,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (e) {
    if (e instanceof PayError) {
      const status =
        e.code === "not_found"
          ? 404
          : e.code === "already_owned"
            ? 409
            : e.code === "invalid_body" || e.code === "not_purchasable"
              ? 400
              : 503;
      return apiEnvelope(status, e.message);
    }
    logger.error({ event: "pay.order_create_failed", error: String(e) });
    return apiEnvelope(500, "下单失败,请稍后再试");
  }
}
