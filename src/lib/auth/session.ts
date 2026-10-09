/**
 * 会话读侧最小实现(arch/05-services §3.2):jose 校验 access token,供统计去管理员
 * 口径(M3)复用。签发/登记/吊销/续期在 issuer.ts(M4,含 Redis jti 双查);
 * 本文件只读不写、不依赖 Redis——验签通过即认,完整校验不走这里。
 * ⚠️ 单一契约(2026-10-09 收银台死循环事故):只吃**裸 token 值**。cookie 解析
 * 一律交给框架(NextRequest.cookies / cookies()),禁止再传完整 Cookie 头
 * 字符串——曾有 readSessionUser(header) 与本函数双形态并存,类型不可区分、
 * 传错静默降级为未登录,/pay 页踩雷(已删,教训入 session.test.ts)。
 */
import { jwtVerify } from "jose";

import { env } from "@/lib/env";

import { ACCESS_COOKIE_NAME } from "./constants";

export { ACCESS_COOKIE_NAME };

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
