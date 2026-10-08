/**
 * 付费权益读写(M21 批③,提案 §4/§5.1):content_post_purchase 的**唯一
 * 写入口**——订单发货(OD 回调/对账补发)与退款撤销(CD 回调)都走这里,
 * admin 人工开通/恢复(批⑤)同样复用,保证授予=upsert revokedAt=null 的
 * 单一口径。一文一用户一条(唯一约束),软撤销审计可恢复。
 */
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export const PURCHASE_SOURCES = ["order", "import", "manual", "admin_restore"] as const;
export type PurchaseSource = (typeof PURCHASE_SOURCES)[number];

type Tx = Prisma.TransactionClient;

/** 授予(发货唯一路径):upsert 恢复软撤销的行;重授更新 grantedAt/orderId */
export async function grantPurchase(
  tx: Tx,
  input: { userId: bigint; postId: bigint; orderId?: bigint | null; source: PurchaseSource },
): Promise<void> {
  await tx.contentPostPurchase.upsert({
    where: { userId_postId: { userId: input.userId, postId: input.postId } },
    update: {
      revokedAt: null,
      revokedReason: null,
      orderId: input.orderId ?? null,
      source: input.source,
      grantedAt: new Date(),
    },
    create: {
      userId: input.userId,
      postId: input.postId,
      orderId: input.orderId ?? null,
      source: input.source,
    },
  });
}

/** 软撤销(退款 CD 回调/admin 售后):幂等,已撤销不动 revokedAt */
export async function revokePurchase(
  tx: Tx,
  input: { userId: bigint; postId: bigint; reason: string },
): Promise<void> {
  await tx.contentPostPurchase.updateMany({
    where: { userId: input.userId, postId: input.postId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: input.reason.slice(0, 200) },
  });
}

/** 有效权益 = 存在且未撤销(门禁/下单前置校验共用;(userId,postId) 唯一索引 O(1)) */
export async function hasValidPurchase(userId: bigint, postId: bigint): Promise<boolean> {
  const row = await prisma.contentPostPurchase.findUnique({
    where: { userId_postId: { userId, postId } },
    select: { revokedAt: true },
  });
  return row !== null && row.revokedAt === null;
}
