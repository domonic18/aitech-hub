/**
 * 短信下发守卫(M65):频控 → 预算占位 → 调服务商 → 记账/归还。
 *
 * 登录下发与账号中心绑定下发共用这一条路径,避免「新入口漏了预算熔断」这
 * 类旁路缺陷(扩展点接入手册的反面教材)。调用方只负责:解析入参、解析
 * 目标号码与模板、决定不可用时的文案;其余记账与日志在此收口。
 *
 * 日志纪律:手机号掩码、IP 哈希,验证码与服务商原始报文不入日志
 * (providerCode 不用 `code` 字段——logger redact 含裸 code)。
 */
import { maskPhone } from "@/lib/auth/mask";
import { ipHash, logger } from "@/lib/logger";

import type { ActiveSmsChannel } from "./config";
import {
  SMS_BUDGET_WARN_RATIO,
  checkSendQuota,
  getSendBudgetUsage,
  recordSend,
  releaseSendBudget,
  reserveSendBudget,
} from "./limit";

/** 恒定成功文案:不暴露号码是否已注册 / 是否已绑定 */
export const SMS_SENT_MESSAGE = "验证码已发送,5 分钟内有效";
export const SMS_THROTTLED_MESSAGE = "发送过于频繁,请稍后再试";

export interface GuardedSendParams {
  channel: ActiveSmsChannel;
  /** 目标号码(登录=用户填写的号;换绑第一步=账号当前号,由服务端取) */
  phone: string;
  /** 缺省用通道配置的登录模板;绑定场景传 PNVS 预置场景模板 */
  templateCode?: string;
  ip: string;
  /** 日志事件前缀,如 sms.code / account.phone.code */
  eventPrefix: string;
  /** 通道不可用/预算熔断时的文案(登录与账号中心口径略异) */
  unavailableMessage: string;
}

export type GuardedSendResult =
  | { ok: true }
  /** 失败已记日志,调用方直接按 status/message 应答 */
  | { ok: false; status: 429 | 503; message: string };

export async function sendSmsCodeGuarded(p: GuardedSendParams): Promise<GuardedSendResult> {
  const masked = maskPhone(p.phone);

  const verdict = await checkSendQuota(p.phone, p.ip, p.channel.dailyLimit);
  if (!verdict.ok) {
    logger.warn({
      event: `${p.eventPrefix}.blocked`,
      scope: verdict.scope,
      phone: masked,
      ipHash: await ipHash(p.ip),
    });
    return verdict.scope === "budget"
      ? { ok: false, status: 503, message: p.unavailableMessage }
      : { ok: false, status: 429, message: SMS_THROTTLED_MESSAGE };
  }

  const reserved = await reserveSendBudget(p.channel.dailyLimit);
  if (!reserved) {
    logger.error({
      event: "sms.budget.exhausted",
      dailyLimit: p.channel.dailyLimit,
      phone: masked,
    });
    return { ok: false, status: 503, message: p.unavailableMessage };
  }

  const result = await p.channel.provider.sendVerifyCode({
    phone: p.phone,
    signName: p.channel.signName,
    templateCode: p.templateCode ?? p.channel.templateCode,
  });

  if (!result.ok) {
    await releaseSendBudget();
    logger.error({
      event: `${p.eventPrefix}.fail`,
      reason: result.reason,
      providerCode: result.code,
      detail: result.message,
      phone: masked,
      ipHash: await ipHash(p.ip),
    });
    return result.reason === "rate_limited"
      ? { ok: false, status: 429, message: SMS_THROTTLED_MESSAGE }
      : { ok: false, status: 503, message: p.unavailableMessage };
  }

  await recordSend(p.phone, p.ip);
  const usage = await getSendBudgetUsage();
  if (usage >= Math.ceil(p.channel.dailyLimit * SMS_BUDGET_WARN_RATIO)) {
    logger.warn({
      event: "sms.budget.warn",
      usage,
      dailyLimit: p.channel.dailyLimit,
      ratio: Number((usage / p.channel.dailyLimit).toFixed(2)),
    });
  }
  logger.info({ event: `${p.eventPrefix}.ok`, phone: masked, ipHash: await ipHash(p.ip) });
  return { ok: true };
}
