/**
 * 用户侧订单列表读侧(M22 批③,需求4):/account/orders 分页(15/页)+
 * 状态分段。归属硬过滤 userId(admin 全量列表在 pay/admin.ts,不复用——
 * 用户侧禁越权字段如 clientIp/gatewayOpenOrderId)。
 */
import { prisma } from "@/lib/db";

export const USER_ORDERS_PAGE_SIZE = 15;

export interface UserOrderRow {
  orderNo: string;
  status: string;
  amount: string;
  title: string;
  createdAt: string;
  paidAt: string | null;
  expiresAt: string;
}

export async function listOrdersForUser({
  userId,
  page,
  status,
}: {
  userId: bigint;
  page: number;
  status: string | null;
}): Promise<{ items: UserOrderRow[]; total: number; page: number }> {
  const where = {
    userId,
    ...(status ? { status } : {}),
  };
  const [orders, total] = await Promise.all([
    prisma.payOrder.findMany({
      where,
      select: {
        orderNo: true,
        status: true,
        amount: true,
        createdAt: true,
        paidAt: true,
        expiresAt: true,
        items: { select: { title: true }, take: 1 },
      },
      orderBy: { id: "desc" },
      skip: (page - 1) * USER_ORDERS_PAGE_SIZE,
      take: USER_ORDERS_PAGE_SIZE,
    }),
    prisma.payOrder.count({ where }),
  ]);
  return {
    items: orders.map((o) => ({
      orderNo: o.orderNo,
      status: o.status,
      amount: o.amount.toFixed(2),
      title: o.items[0]?.title ?? "",
      createdAt: o.createdAt.toISOString(),
      paidAt: o.paidAt?.toISOString() ?? null,
      expiresAt: o.expiresAt.toISOString(),
    })),
    total,
    page,
  };
}
