/**
 * 邮箱一次性令牌(M21 批⓪,D1 邮箱通道):注册认证/绑定邮箱/找回密码共用。
 * 原始令牌 32 字节 hex 仅出现于邮件链接;库中只存 sha256(同 UserPat 先例,
 * user_verification_token.token_hash char(64));单次消费 + TTL;
 * 同 purpose 重新申请时未消费旧令牌一并作废(防链接堆积、旧链失效)。
 * DB 侧闭环由 e2e 覆盖;纯哈希函数单测钉行为。
 */
import { createHash, randomBytes } from "node:crypto";

import { type Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export const EMAIL_TOKEN_TTL_MINUTES = 30;

export const TOKEN_PURPOSE_REGISTER = "register_verify";
export const TOKEN_PURPOSE_BIND = "bind_email";
export const TOKEN_PURPOSE_RESET = "password_reset";
export const TOKEN_PURPOSES = [
  TOKEN_PURPOSE_REGISTER,
  TOKEN_PURPOSE_BIND,
  TOKEN_PURPOSE_RESET,
] as const;
export type TokenPurpose = (typeof TOKEN_PURPOSES)[number];

export function hashEmailToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** 签发新令牌:同账号同 purpose 未消费旧令牌作废;返回原始令牌(调用方拼进邮件链接) */
export async function issueEmailToken(userId: bigint, purpose: TokenPurpose): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_MINUTES * 60_000);
  await prisma.$transaction([
    prisma.userVerificationToken.deleteMany({ where: { userId, purpose, consumedAt: null } }),
    prisma.userVerificationToken.create({
      data: { userId, purpose, tokenHash: hashEmailToken(raw), expiresAt },
    }),
  ]);
  return raw;
}

export type ConsumeResult = "ok" | "expired" | "invalid";
export interface ConsumeOutcome {
  status: ConsumeResult;
  /** 消费成功时返回归属用户 id(调用方记事件/置验证态,免二次反查竞态) */
  userId?: bigint;
}

/**
 * 消费令牌:单次有效。updateMany 带 consumedAt:null 条件原子防并发双花;
 * apply 随消费同事务执行(如置 email_verified_at——消费成功而副作用未落
 * 会让用户拿着"已成功"页面卡在未认证态),双花竞态时不执行 apply。
 */
export async function consumeEmailToken(
  raw: string,
  purpose: TokenPurpose,
  apply?: (tx: Prisma.TransactionClient, userId: bigint) => Promise<unknown>,
): Promise<ConsumeOutcome> {
  if (!raw) return { status: "invalid" };
  const row = await prisma.userVerificationToken.findFirst({
    where: { tokenHash: hashEmailToken(raw), purpose },
  });
  if (!row) return { status: "invalid" };
  if (row.expiresAt.getTime() < Date.now()) return { status: "expired" };
  return prisma.$transaction(async (tx) => {
    const updated = await tx.userVerificationToken.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (updated.count !== 1) return { status: "invalid" as const };
    if (apply) await apply(tx, row.userId);
    return { status: "ok" as const, userId: row.userId };
  });
}
