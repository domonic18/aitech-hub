/**
 * 订单服务(M21 批③,提案 §5.1/§5.2):下单(复用未过期 pending 单,单号
 * 即幂等键)、订单查询(归属校验)。金额全程 Decimal 字符串化禁 float;标题
 * 清洗 ≤42 字;日志只记事件与订单号(安全清单 #9)。回调/对账入账状态机
 * (markOrderPaidAndGrant/handleNotify)已拆 order-notify(技术债批⑤),
 * 此处 re-export 维持消费面(路由/reconcile)同入口。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getPayGateway } from "@/lib/pay/gateway";
import { GATEWAY_XUNHU, getPayGatewayRuntimeConfig } from "@/lib/pay/gateway-config";
import { hasValidPurchase } from "@/lib/pay/entitlement";

export { handleNotify, markOrderPaidAndGrant } from "./order-notify";

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
