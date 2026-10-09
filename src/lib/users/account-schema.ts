/**
 * 账号中心契约(M22 批②):纯声明零 IO(post-schema 同纪律)——客户端
 * 表单岛与服务端 lib 共用同一真相源。服务逻辑在 account-profile.ts(引
 * bcrypt/uploadMedia,仅服务端);客户端只许 import 本文件。
 */
import { z } from "zod";

/** 资料边界唯一真相源(表单 maxLength 与 zod 共用) */
export const ACCOUNT_LIMITS = {
  nickname: { min: 2, max: 20 },
  bio: { max: 500 },
} as const;

/** 头像上限(2026-10-09 方案):比媒体库 10MB 收紧,头像无需大图 */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
/** 头像类型:jpg/png/webp(gif 不入头像,动图无意义且缩略管线不出) */
export const AVATAR_MIME_WHITELIST = ["image/jpeg", "image/png", "image/webp"] as const;

export const profileUpdateSchema = z.object({
  nickname: z.string().trim().min(ACCOUNT_LIMITS.nickname.min).max(ACCOUNT_LIMITS.nickname.max),
  bio: z.string().trim().max(ACCOUNT_LIMITS.bio.max),
});

export const passwordChangeSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string(),
});

/** 业务错误 → Handler 按码映射 HTTP(UserAdminError 同款) */
export type AccountErrorCode =
  | "not_found"
  | "wrong_password"
  | "no_password"
  | "invalid_new_password"
  | "unsupported"
  | "too_large";

export class AccountError extends Error {
  constructor(
    public code: AccountErrorCode,
    message: string,
  ) {
    super(message);
  }
}
