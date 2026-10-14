/**
 * admin 账号 ↔ 飞书身份绑定(M29 批①):免登白名单本体 CRUD。双唯一锚:
 * 一账号一身份(userId unique)/ 一身份一账号(unionId unique),跨锚冲突
 * 409;解绑仅限自绑人(现网单管理员,plan「超管解绑」由自解绑覆盖)。
 * 兑换侧 findBindingByUnion 供 exchange 路由做白名单判定(fail-closed)。
 */
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

import { FeishuError } from "./feishu-errors";

export interface FeishuBindingView {
  /** 兑换时飞书姓名快照(审计友好) */
  feishuName: string | null;
  openId: string;
  /** ISO 字符串(过 RSC 边界不失真) */
  boundAt: string;
}

export async function getBindingForUser(userId: bigint): Promise<FeishuBindingView | null> {
  const row = await prisma.adminFeishuBinding.findUnique({ where: { userId } });
  return row
    ? { feishuName: row.feishuName, openId: row.openId, boundAt: row.createdAt.toISOString() }
    : null;
}

/** 绑定/换绑(密码会话内自绑):unionId 已被其他账号占用即拒 */
export async function bindFeishu(
  userId: bigint,
  identity: { unionId: string; openId: string; name: string },
): Promise<FeishuBindingView> {
  const existingByUnion = await prisma.adminFeishuBinding.findUnique({
    where: { unionId: identity.unionId },
  });
  if (existingByUnion && existingByUnion.userId !== userId) {
    throw new FeishuError("conflict", "该飞书身份已绑定其他账号(请先在原账号解绑)");
  }
  const row = await prisma.adminFeishuBinding.upsert({
    where: { userId },
    create: {
      userId,
      unionId: identity.unionId,
      openId: identity.openId,
      feishuName: identity.name || null,
    },
    update: {
      unionId: identity.unionId,
      openId: identity.openId,
      feishuName: identity.name || null,
    },
  });
  logger.info({
    event: "auth.feishu.bound",
    userId: userId.toString(),
    rebind: existingByUnion?.userId === userId,
  });
  return { feishuName: row.feishuName, openId: row.openId, boundAt: row.createdAt.toISOString() };
}

/** 解绑;无绑定返回 false(路由层按幂等成功处理) */
export async function unbindFeishu(userId: bigint): Promise<boolean> {
  const row = await prisma.adminFeishuBinding.findUnique({ where: { userId } });
  if (!row) return false;
  await prisma.adminFeishuBinding.delete({ where: { userId } });
  logger.info({ event: "auth.feishu.unbound", userId: userId.toString() });
  return true;
}

/** 兑换白名单判定用(unionId 精确查) */
export async function findBindingByUnion(unionId: string) {
  return prisma.adminFeishuBinding.findUnique({ where: { unionId } });
}
