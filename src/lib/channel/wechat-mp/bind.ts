/**
 * 公众号 ↔ 站内账号绑定(M66):一次性绑定码。
 *
 * 认证订阅号**没有网页授权权限**,拿不到 openid;所以打通只能反着来——
 * 用户在站内生成 8 位码 → 在公众号里把码发出去 → 入站链路查到 Redis 里的
 * `channel:wxmp:bind:<code>` 即写 `openid ↔ userId`。
 *
 * 码只有 10 分钟命、用后即焚(NX 语义天然防撞);字符集剔了 0O1lI,
 * 用户手动抄写不歧义。
 */
import { randomInt } from "node:crypto";

import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";

import {
  WECHAT_MP_BIND_CODE_ALPHABET,
  WECHAT_MP_BIND_CODE_LENGTH,
  WECHAT_MP_BIND_TTL_SECONDS,
  wechatMpKeys,
} from "./constants";

function randomCode(): string {
  let out = "";
  for (let i = 0; i < WECHAT_MP_BIND_CODE_LENGTH; i++) {
    out += WECHAT_MP_BIND_CODE_ALPHABET[randomInt(WECHAT_MP_BIND_CODE_ALPHABET.length)];
  }
  return out;
}

/** 生成并登记绑定码(撞码即换一个;5 次都撞说明环境异常,直接报错) */
export async function issueBindCode(
  userId: bigint,
): Promise<{ code: string; expiresInSeconds: number }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const set = await redis.set(
      wechatMpKeys.bind(code),
      userId.toString(),
      "EX",
      WECHAT_MP_BIND_TTL_SECONDS,
      "NX",
    );
    if (set === "OK") return { code, expiresInSeconds: WECHAT_MP_BIND_TTL_SECONDS };
  }
  throw new Error("绑定码生成失败,请重试");
}

export interface UserBindingView {
  /** 是否已绑定公众号 */
  bound: boolean;
  /** 脱敏 openid(能认出是同一个号,不整串外露) */
  openidMasked: string | null;
  boundAt: string | null;
}

function maskOpenid(openid: string): string {
  if (openid.length <= 10) return `${openid.slice(0, 2)}***`;
  return `${openid.slice(0, 6)}***${openid.slice(-4)}`;
}

/** 站内账号当前绑定状态(账号设置页展示) */
export async function getUserBinding(userId: bigint): Promise<UserBindingView> {
  const row = await prisma.channelWechatMpUser.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: { openid: true, updatedAt: true },
  });
  if (!row) return { bound: false, openidMasked: null, boundAt: null };
  return {
    bound: true,
    openidMasked: maskOpenid(row.openid),
    boundAt: row.updatedAt.toISOString(),
  };
}
