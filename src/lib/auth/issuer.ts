/**
 * 会话写侧(arch/05-services §3.2,M4):签发 / jti 登记 / 吊销 / 滑动续期。
 * 与 session.ts(M3 读侧最小实现)分层:完整校验 = JWT 验签 + Redis jti 登记双查,
 * 只在此处;读侧不依赖 Redis,服务统计去管理员的宽松口径。
 */
import { jwtVerify, SignJWT } from "jose";

import { env } from "@/lib/env";
import { redis } from "@/lib/redis";

import { ACCESS_COOKIE_NAME, type AccessClaims } from "./session";

export const SESSION_TTL_SECONDS = 7 * 24 * 3600;
/** 剩余有效期低于该阈值时滑动续期(轮换 jti) */
export const SLIDE_THRESHOLD_SECONDS = 24 * 3600;

export interface FullClaims extends AccessClaims {
  jti: string;
  /** token 过期时间(epoch 秒),续期判定用 */
  exp: number;
}

const secretKey = new TextEncoder().encode(env.AUTH_SECRET);
const registryKey = (jti: string): string => `sess:${jti}`;

/** Cookie 形态(arch/05-services §3.2):httpOnly + Lax;secure 跟随站点 URL 协议 */
export function sessionCookie(token: string): {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    name: ACCESS_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: env.NEXT_PUBLIC_SITE_URL.startsWith("https"),
    path: "/",
    maxAge: token ? SESSION_TTL_SECONDS : 0,
  };
}

/** 签发新会话:新 jti 记入 Redis 登记表(TTL 对齐有效期) */
export async function issueSession(claims: AccessClaims): Promise<{ token: string; jti: string }> {
  const jti = crypto.randomUUID();
  const token = await new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setJti(jti)
    .setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS)
    .sign(secretKey);
  await redis.set(registryKey(jti), "1", "EX", SESSION_TTL_SECONDS);
  return { token, jti };
}

/** 完整校验:JWT 验签 + jti 登记存在性(封住"签发后即吊销"窗口);非法/已吊销 → null */
export async function verifyFullSession(
  token: string | undefined | null,
): Promise<FullClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey, { algorithms: ["HS256"] });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.jti !== "string"
    ) {
      return null;
    }
    if (!(await redis.get(registryKey(payload.jti)))) return null;
    return { sub: payload.sub, role: payload.role, jti: payload.jti, exp: payload.exp ?? 0 };
  } catch {
    return null;
  }
}

/** 从 Cookie 头完整校验会话(admin 页面/端点用;统计口径走 session.ts) */
export async function readFullSessionUser(cookieHeader: string | null): Promise<FullClaims | null> {
  if (!cookieHeader) return null;
  const token = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ACCESS_COOKIE_NAME}=`))
    ?.slice(ACCESS_COOKIE_NAME.length + 1);
  return verifyFullSession(token);
}

export async function revokeSession(jti: string): Promise<void> {
  await redis.del(registryKey(jti));
}

export function needsRenewal(claims: FullClaims): boolean {
  return claims.exp - Math.floor(Date.now() / 1000) < SLIDE_THRESHOLD_SECONDS;
}

/** 滑动续期 = 轮换:先签发登记新 jti,再吊销旧 jti(失败方向为多一份有效会话,TTL 兜底) */
export async function renewSession(claims: FullClaims): Promise<string> {
  const { token } = await issueSession({ sub: claims.sub, role: claims.role });
  await revokeSession(claims.jti);
  return token;
}
