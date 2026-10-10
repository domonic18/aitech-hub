/**
 * 邮箱验证链接落地(M21 批⓪,D1):GET ?token=… → 单次消费 → 置
 * email_verified_at。自包含 HTML 应答(批⑤ 前台登录页落地前不依赖未建页面);
 * 链接含原始令牌属敏感一次性凭据,响应 no-store 防中间缓存。令牌失效/过期
 * 给重发指引;消费成功/失败都记 pino 事件(无 PII,token 不落日志)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { TOKEN_PURPOSE_REGISTER, consumeEmailToken } from "@/lib/auth/email-verify";
import { isOverLimit, recordHit } from "@/lib/auth/rate-limit";
import { clientIp } from "@/lib/http/request";
import { ipHash, logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** 验证端点配额:IP 时窗 30 次(令牌 256 位随机,爆破不可行;配额只防滥用) */
const VERIFY_IP_LIMIT = 30;
const VERIFY_IP_WINDOW = 3600;

function page(title: string, detail: string, ok: boolean): NextResponse {
  const color = ok ? "#2bae67" : "#d03050";
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f6f8fa}
.card{background:#fff;border:1px solid #e1e4e8;border-radius:12px;padding:40px 48px;max-width:420px;text-align:center}
h1{font-size:20px;color:${color};margin:0 0 12px}p{color:#57606a;line-height:1.7;margin:0}</style></head>
<body><div class="card"><h1>${title}</h1><p>${detail}</p></div></body></html>`;
  return new NextResponse(html, {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ip = clientIp(req);
  if (await isOverLimit(`auth:verify:ip:${ip}`, VERIFY_IP_LIMIT)) {
    logger.warn({ event: "auth.email_verify.blocked", ipHash: await ipHash(ip) });
    return page("操作过于频繁", "请稍后再试,或联系站长。", false);
  }
  await recordHit(`auth:verify:ip:${ip}`, VERIFY_IP_WINDOW);

  const token = req.nextUrl.searchParams.get("token") ?? "";
  const { status, userId } = await consumeEmailToken(
    token,
    TOKEN_PURPOSE_REGISTER,
    // 消费成功即认证:email_verified_at 与令牌消费同事务,杜绝"页面成功、账号未认证"裂缝
    (tx, uid) =>
      tx.userAccount.update({ where: { id: uid }, data: { emailVerifiedAt: new Date() } }),
  );
  if (status === "expired") {
    return page("链接已过期", "验证链接 30 分钟内有效,请返回登录页重新发送验证邮件。", false);
  }
  if (status !== "ok") {
    logger.warn({ event: "auth.email_verify.invalid", ipHash: await ipHash(ip) });
    return page("链接无效", "验证链接不存在或已被使用,请返回登录页重新发送验证邮件。", false);
  }

  logger.info({
    event: "auth.email_verify.ok",
    userId: userId?.toString(),
    ipHash: await ipHash(ip),
  });
  return page("邮箱验证成功", "你现在可以用用户名/邮箱登录了。", true);
}
