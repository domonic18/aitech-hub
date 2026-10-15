/**
 * 订单入账状态机(M21 批③,提案 §5.1/§5.2;技术债批⑤ 自 order-service 拆出):
 * 回调与对账补发共用的迁移+发货核(markOrderPaidAndGrant)与回调处理
 * (handleNotify)。状态机 pending/closed→paid 宁多发货、paid→refunded;
 * 事务 + updateMany 竞态护栏;金额全程 Decimal 字符串化禁 float;日志只记
 * 事件与订单号(安全清单 #9)。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { grantPurchase, revokePurchase } from "@/lib/pay/entitlement";
import type { GatewayNotifyResult } from "@/lib/pay/gateway/types";

/**
 * OD 入账(回调与对账补发共用,§5.1/§5.2):状态迁移+发货同事务,updateMany
 * 竞态护栏(并发双路仅首笔迁移发货)。closed→paid 兜底:宁多发货不吞单。
 * 返回是否本调用完成迁移(状态已被并发方迁移/不符 → false)。
 */
export async function markOrderPaidAndGrant(input: {
  orderId: bigint;
  userId: bigint;
  postId: bigint;
  transactionId?: string;
  openOrderId?: string;
}): Promise<boolean> {
  const bumped = await prisma.$transaction(async (tx) => {
    const r = await tx.payOrder.updateMany({
      where: { id: input.orderId, status: { in: ["pending", "closed"] } },
      data: {
        status: "paid",
        paidAt: new Date(),
        gatewayTransactionId: input.transactionId ?? null,
        gatewayOpenOrderId: input.openOrderId ?? undefined,
      },
    });
    if (r.count > 0) {
      await grantPurchase(tx, {
        userId: input.userId,
        postId: input.postId,
        orderId: input.orderId,
        source: "order",
      });
    }
    return r.count;
  });
  return bumped > 0;
}

/**
 * 回调入账(提案 §5.1/§6 #4-#6):验签 → 全量落 notify_log(含被拒,可追溯
 * 伪造尝试)→ 状态机迁移。OD:pending/closed→paid(兜底迁移,宁多发货不吞
 * 单)+ 发货;paid 幂等。CD:paid→refunded + 软撤销;refunded 幂等;其余
 * 状态收到 CD 仅留痕。金额不符/单不存在/坏签一律 handled=false 不动状态。
 */
export async function handleNotify(
  verified: GatewayNotifyResult,
  rawPayload: Record<string, string>, // 回调原文全量落库(不含密钥字段,可追溯伪造尝试)
): Promise<{ ok: boolean; handled: boolean }> {
  const order = await prisma.payOrder.findUnique({
    where: { orderNo: verified.orderNo },
    select: {
      id: true,
      userId: true,
      status: true,
      amount: true,
      items: { select: { postId: true } },
    },
  });

  if (!verified.valid || !order) {
    await prisma.payNotifyLog.create({
      data: {
        orderNo: verified.orderNo,
        gatewayStatus: verified.status,
        signValid: verified.valid,
        payload: rawPayload as Prisma.InputJsonValue,
        handled: false,
      },
    });
    if (verified.valid) {
      logger.warn({
        event: "pay.notify_rejected",
        orderNo: verified.orderNo,
        reason: "order_not_found",
      });
    } else {
      logger.warn({
        event: "pay.notify_rejected",
        reason: "bad_sign",
        gatewayStatus: verified.status,
      });
    }
    return { ok: false, handled: false };
  }

  // 金额校验(网关回传 vs 订单;Decimal 归一比较,防篡改安全清单 #6)
  const amountMatch =
    verified.totalFee !== "" && order.amount.equals(new Prisma.Decimal(verified.totalFee));
  if (!amountMatch) {
    await prisma.payNotifyLog.create({
      data: {
        orderNo: verified.orderNo,
        gatewayStatus: verified.status,
        signValid: true,
        payload: rawPayload as Prisma.InputJsonValue,
        handled: false,
      },
    });
    logger.warn({
      event: "pay.notify_rejected",
      orderNo: verified.orderNo,
      reason: "amount_mismatch",
    });
    return { ok: false, handled: false };
  }

  const postId = order.items[0]?.postId;
  let handled = false;

  if (verified.status === "OD") {
    if (order.status === "paid") {
      handled = true; // 重放/重复通知幂等
    } else if (order.status === "pending" || order.status === "closed") {
      // closed→paid 兜底迁移(提案 §5.2:宁多发货不吞单);迁移+发货收敛进
      // markOrderPaidAndGrant(与对账补发共用,updateMany 竞态护栏)
      if (postId !== undefined) {
        const migrated = await markOrderPaidAndGrant({
          orderId: order.id,
          userId: order.userId,
          postId,
          transactionId: verified.transactionId,
          openOrderId: verified.openOrderId,
        });
        if (migrated)
          logger.info({ event: "pay.order_paid", orderNo: verified.orderNo, via: "notify" });
      }
      handled = true; // 状态已与通知一致(本笔或并发方迁移)
    }
  } else if (verified.status === "CD") {
    if (order.status === "refunded") {
      handled = true; // 重复退款通知幂等
    } else if (order.status === "paid") {
      await prisma.$transaction(async (tx) => {
        const bumped = await tx.payOrder.updateMany({
          where: { id: order.id, status: "paid" },
          data: { status: "refunded", refundedAt: new Date() },
        });
        if (bumped.count > 0 && postId !== undefined) {
          await revokePurchase(tx, {
            userId: order.userId,
            postId,
            reason: `gateway_refund:${verified.transactionId ?? ""}`,
          });
        }
      });
      handled = true;
      logger.info({ event: "pay.order_refunded", orderNo: verified.orderNo });
    }
  }
  // WP/UD/RD:仅留痕不动权益(D3 决议)

  await prisma.payNotifyLog.create({
    data: {
      orderNo: verified.orderNo,
      gatewayStatus: verified.status,
      signValid: true,
      payload: rawPayload as Prisma.InputJsonValue,
      handled,
    },
  });
  return { ok: true, handled };
}
