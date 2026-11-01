/**
 * 账号中心手机号绑定 / 换绑状态机(M65 P1,arch/05-services §3.4)。
 *
 * 本模块只管「发码前该发往谁」与「验码后如何落库」,不碰服务商与 HTTP:
 * 端点负责通道、频控、锁定与应答口径(与 /api/auth/sms-* 同分层)。
 *
 * 两步换绑的中间态放 Redis 而非库表:10 分钟一次性标记,失败重来即是新的
 * 一轮,不需要额外的业务表(YAGNI);标记按 userId 归属,天然绑定当前会话。
 *
 * 日志纪律:userId 可记,手机号一律掩码,验证码永不落日志。
 */
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";
import { USER_STATUS_ACTIVE } from "@/lib/users/user-status";

import {
  PHONE_REBIND_WINDOW_SECONDS,
  PhoneBindError,
  SMS_TEMPLATE,
  type PhoneScene,
} from "./scenes";

const rebindKey = (userId: bigint): string => `sms:phone:rebind:${userId.toString()}`;

export interface AccountPhoneState {
  phone: string | null;
  role: string;
  status: string;
}

export async function getAccountPhoneState(userId: bigint): Promise<AccountPhoneState> {
  const u = await prisma.userAccount.findUnique({
    where: { id: userId },
    select: { phone: true, role: true, status: true },
  });
  if (!u) throw new PhoneBindError("not_found", "账号不存在");
  return u;
}

/** 换绑第一步通过后的放行标记(一次性,10 分钟窗口) */
export async function markRebindVerified(userId: bigint): Promise<void> {
  await redis.set(rebindKey(userId), "1", "EX", PHONE_REBIND_WINDOW_SECONDS);
}

export async function hasRebindVerified(userId: bigint): Promise<boolean> {
  return Boolean(await redis.get(rebindKey(userId)));
}

export async function clearRebindVerified(userId: bigint): Promise<void> {
  await redis.del(rebindKey(userId));
}

export interface SendPlan {
  /** 验证码发往的号码 = 待校验的号码(换绑第一步是当前号,其余是新号) */
  targetPhone: string;
  templateCode: string;
}

function pickNewPhone(phone: string | undefined, current: string | null): string {
  if (!phone) throw new PhoneBindError("invalid_new_phone", "请填写新的手机号");
  if (phone === current) throw new PhoneBindError("same_phone", "新手机号与原手机号相同");
  return phone;
}

function assertBindable(u: AccountPhoneState): void {
  if (u.role === "admin") throw new PhoneBindError("admin_forbidden", "管理员账号不支持绑定手机号");
  if (u.status !== USER_STATUS_ACTIVE)
    throw new PhoneBindError("inactive", "账号状态异常,无法绑定手机号");
}

/**
 * 发码前解析目标号码与模板(下发与校验两端共用,保证「验的就是发的那条」)。
 *
 * 不在下发前查新号是否已被占用:那会让任意登录用户以任意号码探出「该号是否
 * 有账号」,与登录端点恒定应答的防枚举口径冲突;占用判定留到落库时(用户已
 * 证明持有该号,此时告知归属冲突不构成他人信息泄漏)。
 */
export async function planSend(
  userId: bigint,
  scene: PhoneScene,
  newPhone: string | undefined,
): Promise<SendPlan> {
  const u = await getAccountPhoneState(userId);
  assertBindable(u);

  if (scene === "bind") {
    if (u.phone) throw new PhoneBindError("has_phone", "当前已绑定手机号,请使用「更换手机号」");
    return {
      targetPhone: pickNewPhone(newPhone, null),
      templateCode: SMS_TEMPLATE.bindNew,
    };
  }

  if (!u.phone) throw new PhoneBindError("no_phone", "当前未绑定手机号,请使用「绑定手机号」");

  if (scene === "rebind_old") {
    return { targetPhone: u.phone, templateCode: SMS_TEMPLATE.verifyCurrent };
  }

  if (!(await hasRebindVerified(userId)))
    throw new PhoneBindError("flow_required", "请先验证当前绑定的手机号");
  return {
    targetPhone: pickNewPhone(newPhone, u.phone),
    templateCode: SMS_TEMPLATE.rebindNew,
  };
}

/**
 * 验码通过后落库(调用前已完成校验)。
 * `requireRebindVerified` 为真时二次核对并消费放行标记——两个端点都不信任
 * 客户端提交的场景顺序。
 */
export async function commitPhone(
  userId: bigint,
  phone: string,
  opts: { requireRebindVerified: boolean },
): Promise<void> {
  const u = await getAccountPhoneState(userId);
  assertBindable(u);

  if (opts.requireRebindVerified) {
    if (!(await hasRebindVerified(userId)))
      throw new PhoneBindError("flow_required", "请先验证当前绑定的手机号");
    if (phone === u.phone) throw new PhoneBindError("same_phone", "新手机号与原手机号相同");
  }

  const owner = await prisma.userAccount.findUnique({ where: { phone }, select: { id: true } });
  if (owner && owner.id !== userId)
    throw new PhoneBindError("phone_taken", "该手机号已绑定其他账号");

  try {
    await prisma.userAccount.update({ where: { id: userId }, data: { phone } });
  } catch (e) {
    // 并发换绑撞唯一约束:回读口径同上
    if ((e as { code?: string }).code === "P2002")
      throw new PhoneBindError("phone_taken", "该手机号已绑定其他账号");
    throw e;
  }

  if (opts.requireRebindVerified) await clearRebindVerified(userId);

  logger.info({
    event: "account.phone_bound",
    userId: userId.toString(),
    rebind: opts.requireRebindVerified,
  });
}
