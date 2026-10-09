/**
 * 账号中心自助域服务(M22 批②,需求2/3/10):资料改/密码改/头像路径写入。
 * 契约(常量/zod/错误类)在 account-schema.ts 纯声明零 IO——客户端组件只许
 * 从那里 import;本文件引 bcrypt/uploadMedia(node:fs),仅服务端可用。
 * 头像文件走 /api/media 同款 uploadMedia 管线(sha1 去重/sharp 管线),本域
 * 只做 mime/大小预检与 avatarPath 落库;旧头像文件不删(媒体库统一归档口径)。
 */
import bcrypt from "bcryptjs";
import type { z } from "zod";

import { validatePassword } from "@/lib/auth/rules";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

import { uploadMedia } from "@/lib/media/service";

import {
  AccountError,
  AVATAR_MIME_WHITELIST,
  AVATAR_MAX_BYTES,
  passwordChangeSchema,
  profileUpdateSchema,
} from "./account-schema";

export {
  ACCOUNT_LIMITS,
  AVATAR_MAX_BYTES,
  AVATAR_MIME_WHITELIST,
  AccountError,
  passwordChangeSchema,
  profileUpdateSchema,
} from "./account-schema";
export type { AccountErrorCode } from "./account-schema";

/** 账号中心个人资料视图(设置页/API 共用) */
export interface AccountProfileData {
  nickname: string | null;
  avatarPath: string | null;
  bio: string | null;
  hasPassword: boolean;
}

export async function getAccountProfile(userId: bigint): Promise<AccountProfileData> {
  const u = await prisma.userAccount.findUnique({
    where: { id: userId },
    select: { nickname: true, avatarPath: true, bio: true, passwordHash: true },
  });
  if (!u) throw new AccountError("not_found", "账号不存在");
  return {
    nickname: u.nickname,
    avatarPath: u.avatarPath,
    bio: u.bio,
    hasPassword: u.passwordHash !== null,
  };
}

export async function updateProfile(
  userId: bigint,
  input: z.infer<typeof profileUpdateSchema>,
): Promise<AccountProfileData> {
  const u = await prisma.userAccount.update({
    where: { id: userId },
    data: { nickname: input.nickname, bio: input.bio || null },
    select: { nickname: true, avatarPath: true, bio: true, passwordHash: true },
  });
  logger.info({ event: "account.profile_updated", userId: userId.toString() });
  return {
    nickname: u.nickname,
    avatarPath: u.avatarPath,
    bio: u.bio,
    hasPassword: u.passwordHash !== null,
  };
}

/** 密码修改:旧密码必验(无密码账号不可走此口,走忘记密码链);bcrypt 12 同注册 */
export async function changePassword(
  userId: bigint,
  input: z.infer<typeof passwordChangeSchema>,
): Promise<void> {
  const u = await prisma.userAccount.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!u) throw new AccountError("not_found", "账号不存在");
  if (!u.passwordHash) throw new AccountError("no_password", "该账号尚未设置密码,请走忘记密码设置");
  const ok = await bcrypt.compare(input.oldPassword, u.passwordHash);
  if (!ok) throw new AccountError("wrong_password", "当前密码不正确");
  const msg = validatePassword(input.newPassword);
  if (msg) throw new AccountError("invalid_new_password", msg);
  const passwordHash = await bcrypt.hash(input.newPassword, 12);
  await prisma.userAccount.update({ where: { id: userId }, data: { passwordHash } });
  logger.info({ event: "account.password_changed", userId: userId.toString() });
}

/**
 * 头像上传(mime/大小预检 → uploadMedia 管线 → avatarPath 落库):
 * 返回站内路径(/wp-content/uploads/...);旧头像文件不删(媒体库归档口径)。
 */
export async function changeAvatar(
  userId: bigint,
  input: { data: Uint8Array; mime: string; filename: string },
): Promise<{ avatarPath: string }> {
  if (!(AVATAR_MIME_WHITELIST as readonly string[]).includes(input.mime)) {
    throw new AccountError("unsupported", "头像仅支持 jpg/png/webp");
  }
  if (input.data.byteLength > AVATAR_MAX_BYTES) {
    throw new AccountError("too_large", "头像不超过 2MB");
  }
  const saved = await uploadMedia(input);
  await prisma.userAccount.update({
    where: { id: userId },
    data: { avatarPath: saved.path },
  });
  logger.info({
    event: "account.avatar_changed",
    userId: userId.toString(),
    mediaId: saved.id,
    reused: saved.reused,
  });
  return { avatarPath: saved.path };
}
