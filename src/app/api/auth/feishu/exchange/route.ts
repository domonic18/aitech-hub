/**
 * 飞书工作台免登兑换端点(M29 批② 的服务端底座,批① 先行交付):POST {code}
 * (h5sdk requestAccess/requestAuthCode 取得,5 分钟单次)→ 飞书 OAuth v2 换
 * 身份 → admin_feishu_
 * binding 白名单精确命中 → 目标账号仍为 active admin → 签发既有 jose 会话
 * Cookie(不新造会话机制)。fail-closed:未配置/未启用/未绑定/角色变更一律拒;
 * upstream 细节仅日志不外吐。IP 30/hour 限频防爆破(授权码本身单次有效)。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ADMIN_ROLE } from "@/lib/auth/constants";
import { exchangeFeishuIdentity } from "@/lib/auth/feishu-client";
import { getFeishuRuntimeConfig } from "@/lib/auth/feishu-config";
import { findBindingByUnion } from "@/lib/auth/feishu-binding";
import { FeishuError } from "@/lib/auth/feishu-errors";
import { issueSession, sessionCookie } from "@/lib/auth/issuer";
import { isOverLimit, recordHit } from "@/lib/auth/rate-limit";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/http/origin";
import { clientIp } from "@/lib/http/request";
import { apiEnvelope } from "@/lib/http/response";
import { ipHash, logger } from "@/lib/logger";
import { USER_STATUS_ACTIVE } from "@/lib/users/user-status";

export const dynamic = "force-dynamic";

const EXCH_LIMIT = 30;
const EXCH_WINDOW_SECONDS = 3600;
/** 未命中白名单的模糊提示(不给探测面):绑定走 admin 设置页 */
const UNBOUND_403 = "当前飞书身份未绑定管理账号,请改用密码登录并在后台设置页绑定";

const bodySchema = z.object({ code: z.string().trim().min(1).max(200) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");

  const ip = clientIp(req);
  const bucket = `auth:feishu:exch:${ip}`;
  if (await isOverLimit(bucket, EXCH_LIMIT)) {
    return apiEnvelope(429, "尝试过于频繁,请稍后再试");
  }
  await recordHit(bucket, EXCH_WINDOW_SECONDS);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "invalid body: 授权码不能为空");

  const cfg = await getFeishuRuntimeConfig();
  if (!cfg?.enabled || !cfg.appId || !cfg.appSecret) {
    return apiEnvelope(403, "飞书免登未启用,请改用密码登录");
  }
  const creds = { appId: cfg.appId, appSecret: cfg.appSecret };
  try {
    const identity = await exchangeFeishuIdentity(creds, parsed.data.code);
    const binding = await findBindingByUnion(identity.unionId);
    if (!binding) {
      logger.warn({
        event: "auth.feishu.exchange.reject",
        reason: "unbound",
        unionId: identity.unionId.slice(0, 8),
        ipHash: await ipHash(ip),
      });
      return apiEnvelope(403, UNBOUND_403);
    }
    const user = await prisma.userAccount.findUnique({ where: { id: binding.userId } });
    if (!user || user.role !== ADMIN_ROLE || user.status !== USER_STATUS_ACTIVE) {
      logger.warn({
        event: "auth.feishu.exchange.reject",
        reason: "binding_stale",
        userId: binding.userId.toString(),
        ipHash: await ipHash(ip),
      });
      return apiEnvelope(403, "绑定关系已失效,请改用密码登录并在后台设置页重新绑定");
    }
    const { token } = await issueSession({ sub: user.id.toString(), role: user.role });
    logger.info({
      event: "auth.feishu.exchange.ok",
      userId: user.id.toString(),
      ipHash: await ipHash(ip),
    });
    const res = apiEnvelope(0, "ok", { next: "/admin/" });
    res.cookies.set(sessionCookie(token));
    return res;
  } catch (e) {
    if (e instanceof FeishuError) {
      // upstream 细节仅日志,对外模糊(防探测飞书侧状态)
      if (e.code === "upstream") {
        logger.warn({ event: "auth.feishu.exchange.upstream", msg: e.message });
        return apiEnvelope(502, "飞书服务暂不可用,请稍后重试或改用密码登录");
      }
      return apiEnvelope(400, e.message);
    }
    throw e;
  }
}
