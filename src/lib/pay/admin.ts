/**
 * 支付 admin 读侧(M21 批⑤,提案 §8):订单分页列表(单号/用户/金额/状态/
 * 网关单号/时间,只读)。PayOrder.userId 无 FK 无 relation,用户标识二次
 * 查询映射(页 15 行,IN 查询一次)。人工开通写侧走 entitlement 唯一写入口,
 * 这里不重复实现。
 */
import { prisma } from "@/lib/db";

export const PAY_ORDERS_PAGE_SIZE = 15;

export interface AdminPayOrderRow {
  id: string;
  orderNo: string;
  status: string;
  amount: string;
  gateway: string;
  gatewayTransactionId: string | null;
  userLabel: string; // 手机号 > 用户名 > legacy 用户名 > id 兜底
  title: string;
  createdAt: string;
  paidAt: string | null;
  expiresAt: string;
}

export async function listOrdersAdmin({
  page,
  status,
}: {
  page: number;
  status: string | null;
}): Promise<{ items: AdminPayOrderRow[]; total: number; page: number; status: string | null }> {
  const where = status ? { status } : {};
  const [orders, total] = await Promise.all([
    prisma.payOrder.findMany({
      where,
      select: {
        id: true,
        orderNo: true,
        status: true,
        amount: true,
        gateway: true,
        gatewayTransactionId: true,
        userId: true,
        createdAt: true,
        paidAt: true,
        expiresAt: true,
        items: { select: { title: true }, take: 1 },
      },
      orderBy: { id: "desc" },
      skip: (page - 1) * PAY_ORDERS_PAGE_SIZE,
      take: PAY_ORDERS_PAGE_SIZE,
    }),
    prisma.payOrder.count({ where }),
  ]);

  // 用户标识映射(无 relation;一次 IN 查询)
  const users = await prisma.userAccount.findMany({
    where: { id: { in: orders.map((o) => o.userId) } },
    select: { id: true, phone: true, username: true, legacyUsername: true },
  });
  const labelById = new Map(
    users.map((u) => [
      u.id,
      u.phone ?? u.username ?? u.legacyUsername ?? `user-${u.id.toString()}`,
    ]),
  );

  return {
    items: orders.map((o) => ({
      id: o.id.toString(),
      orderNo: o.orderNo,
      status: o.status,
      amount: o.amount.toFixed(2),
      gateway: o.gateway,
      gatewayTransactionId: o.gatewayTransactionId,
      userLabel: labelById.get(o.userId) ?? o.userId.toString(),
      title: o.items[0]?.title ?? "",
      createdAt: o.createdAt.toISOString(),
      paidAt: o.paidAt?.toISOString() ?? null,
      expiresAt: o.expiresAt.toISOString(),
    })),
    total,
    page,
    status,
  };
}

/** 人工开通/恢复(M21 批⑤ §8):手机号或 wp_user_id 检索用户;返回 null=查无 */
export async function findUserByAccount(raw: string) {
  const q = raw.trim();
  if (q === "") return null;
  const user = await prisma.userAccount.findFirst({
    where: { OR: [{ phone: q }, { wpUserId: /^\d+$/.test(q) ? BigInt(q) : BigInt(-1) }] },
    select: { id: true, phone: true, username: true, legacyUsername: true },
  });
  return user ?? null;
}
