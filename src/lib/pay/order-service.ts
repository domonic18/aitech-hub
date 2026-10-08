/**
 * 订单服务(M21 批③,提案 §5.1/§5.2):下单(复用未过期 pending 单,单号
 * 即幂等键)、回调入账(状态机 pending/closed→paid 宁多发货、paid→refunded,
 * 事务 + 权益发货)、订单查询(归属校验)。金额全程 Decimal 字符串化禁
 * float;标题清洗 ≤42 字;日志只记事件与订单号(安全清单 #9)。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getPayGateway } from "@/lib/pay/gateway";
import { GATEWAY_XUNHU, getPayGatewayRuntimeConfig } from "@/lib/pay/gateway-config";
import { grantPurchase, hasValidPurchase, revokePurchase } from "@/lib/pay/entitlement";
import type { GatewayNotifyResult } from "@/lib/pay/gateway/types";

/** 业务错误 → Handler 按码映射 HTTP 状态(循 PostAdminError 惯例) */
export type PayErrorCode =
  "not_found" | "invalid_body" | "not_purchasable" | "already_owned" | "gateway_off";
export class PayError extends Error {
  constructor(
    public code: PayErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const ORDER_SELECT = {
  id: true,
  orderNo: true,
  userId: true,
  status: true,
  amount: true,
  gateway: true,
  gatewayOpenOrderId: true,
  paidAt: true,
  expiresAt: true,
  items: { select: { postId: true, title: true, unitPrice: true } },
} satisfies Prisma.PayOrderSelect;

export type PayOrderView = {
  orderNo: string;
  status: string;
  amount: string;
  postId: string;
  title: string;
  paidAt: string | null;
  expiresAt: string;
};

/** 订单号:日期时间(17 位)+ 5 位随机,22 字符合 VarChar(32);唯一索引兜底重试 */
function generateOrderNo(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 17);
  const rand = Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, "0");
  return `${ts}${rand}`;
}

/** do.html title 传参清洗(安全清单 #13:≤42 字,去 % 与控制符) */
function sanitizeTitle(raw: string): string {
  return raw
    .replace(/[%\x00-\x1f]/g, "")
    .trim()
    .slice(0, 42);
}

/** TTL 取当前生效网关行的 order_ttl_min;无行回落 30(批② 表内化后的消费口) */
export async function getOrderTtlMin(): Promise<number> {
  const row = await prisma.payGatewayConfig.findFirst({ where: { enabled: true } });
  return row?.orderTtlMin ?? 30;
}

/**
 * 下单(提案 §5.1):校验登录外前置(可购/未持有/收银台开启)→ 复用本人
 * 同文未过期 pending 单(单号幂等)→ 网关 create 取收银链(同一单号重取,
 * 二维码 5min 时效)。金额取服务端定价(purchase_price),客户端不可传价。
 */
export async function createOrReuseOrder(input: {
  userId: bigint;
  postId: bigint;
  clientIp: string;
}): Promise<{ orderNo: string; payUrl: string; amount: string; expiresAt: Date }> {
  const post = await prisma.post.findFirst({
    where: { id: input.postId, status: "published", publishedAt: { not: null } },
    select: { id: true, title: true, isPurchasable: true, purchasePrice: true },
  });
  if (!post) throw new PayError("not_found", "文章不存在");
  if (!post.isPurchasable || post.purchasePrice === null) {
    throw new PayError("not_purchasable", "该文章不支持购买");
  }
  if (await hasValidPurchase(input.userId, input.postId)) {
    throw new PayError("already_owned", "已持有该文章权益");
  }

  const gateway = await getPayGateway();
  if (!gateway) throw new PayError("gateway_off", "收银台未开启");
  const cfg =
    gateway.name === GATEWAY_XUNHU ? await getPayGatewayRuntimeConfig(GATEWAY_XUNHU) : null;
  if (gateway.name === GATEWAY_XUNHU && !cfg?.notifyUrl) {
    // notify_url 空串下单必被网关拒,提前 fail-closed(admin 需先在配置页补全)
    throw new PayError("gateway_off", "支付回调地址未配置,请联系站长");
  }
  const notifyUrl = gateway.name === GATEWAY_XUNHU ? (cfg?.notifyUrl ?? "") : "";
  const returnUrl = gateway.name === GATEWAY_XUNHU ? (cfg?.returnUrl ?? "") : "";

  const amount = post.purchasePrice.toFixed(2); // Decimal → "5.00" 字符串,禁 float
  const ttlMin = await getOrderTtlMin();
  const expiresAt = new Date(Date.now() + ttlMin * 60_000);

  // 复用本人同文未过期 pending 单(幂等键语义;过期单留给对账 job 关闭)
  let order = await prisma.payOrder.findFirst({
    where: {
      userId: input.userId,
      status: "pending",
      expiresAt: { gt: new Date() },
      items: { some: { postId: input.postId } },
    },
    select: { id: true, orderNo: true },
    orderBy: { id: "desc" },
  });
  if (!order) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        order = await prisma.payOrder.create({
          data: {
            orderNo: generateOrderNo(),
            userId: input.userId,
            status: "pending",
            amount,
            gateway: gateway.name,
            expiresAt,
            clientIp: input.clientIp || null,
            items: {
              create: { postId: input.postId, title: sanitizeTitle(post.title), unitPrice: amount },
            },
          },
          select: { id: true, orderNo: true },
        });
        break;
      } catch (e) {
        // uq_pay_order_order_no 撞号(极小概率)重试;其余错误上抛
        if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e;
      }
    }
    if (!order) throw new PayError("invalid_body", "下单失败,请重试");
  }

  const created = await gateway.create({
    orderNo: order.orderNo,
    amount,
    title: sanitizeTitle(post.title),
    notifyUrl,
    returnUrl,
    clientIp: input.clientIp || undefined,
  });
  if (created.openOrderId) {
    await prisma.payOrder.update({
      where: { id: order.id },
      data: { gatewayOpenOrderId: created.openOrderId },
    });
  }
  logger.info({
    event: "pay.order_created",
    orderNo: order.orderNo,
    gateway: gateway.name,
    amount,
  });
  return { orderNo: order.orderNo, payUrl: created.payUrl, amount, expiresAt };
}

/** 订单查询(本人或 admin;轮询读库不触网关,实时性由回调 + 对账 job 保证) */
export async function getOrderView(
  orderNo: string,
  requesterId: bigint,
  isAdmin: boolean,
): Promise<PayOrderView | null> {
  const order = await prisma.payOrder.findUnique({ where: { orderNo }, select: ORDER_SELECT });
  if (!order || (order.userId !== requesterId && !isAdmin)) return null;
  return {
    orderNo: order.orderNo,
    status: order.status,
    amount: order.amount.toFixed(2),
    postId: order.items[0]?.postId.toString() ?? "",
    title: order.items[0]?.title ?? "",
    paidAt: order.paidAt?.toISOString() ?? null,
    expiresAt: order.expiresAt.toISOString(),
  };
}

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
