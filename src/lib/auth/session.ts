/**
 * 会话读侧最小实现(05 文档 §3.2):jose 校验 access token,供统计去管理员
 * 口径(M3)与后续 admin 判定复用。签发/刷新/吊销随 M4 认证交付;
 * 本文件只读不写,不依赖 Redis。
 */
import { jwtVerify } from "jose";

import { env } from "@/lib/env";

export const ACCESS_COOKIE_NAME = "ah_at";
export const REFRESH_COOKIE_NAME = "ah_rt";

export interface AccessClaims {
  sub: string;
  role: string;
}

const secretKey = new TextEncoder().encode(env.AUTH_SECRET);

/** 校验 access token;非法/过期返回 null(调用方按未登录处理) */
export async function verifyAccessToken(
  token: string | undefined | null,
): Promise<AccessClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey, { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.role !== "string") return null;
    return { sub: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

/** 从 Cookie 头解析出当前会话身份(无会话/无效 → null) */
export async function readSessionUser(cookieHeader: string | null): Promise<AccessClaims | null> {
  if (!cookieHeader) return null;
  const token = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ACCESS_COOKIE_NAME}=`))
    ?.slice(ACCESS_COOKIE_NAME.length + 1);
  return verifyAccessToken(token);
}
