/**
 * 短信通道抽象(M65,plan M65):登录 / 绑定场景只需两种能力——发验证码、校验
 * 验证码。验证码本体由服务商托管(PNVS 默认 5 分钟有效、60 秒间隔、新码覆盖
 * 旧码),本站不落库、不缓存,故无 OTP 表;实现只做协议适配与错误归类,
 * 调用方(Route Handler)据此决定 HTTP 语义与频控记账。
 *
 * 错误归类是稳定契约:provider 只回答「为什么失败」,不替调用方决定文案与
 * 状态码(同一 reason 在发送端点与校验端点语义不同)。
 */

export type SmsFailureReason =
  /** 服务商侧频控:同号间隔未到 / 小时日限额 / 平台流控 */
  | "rate_limited"
  /** 账户额度:余额不足、套餐耗尽、日/月限额 */
  | "quota_exhausted"
  /** 配置非法:签名/模板不存在或未报备、权限不足、参数不合法 */
  | "config_invalid"
  /** 网络 / 未知错误 */
  | "provider_error";

export interface SendVerifyCodeInput {
  phone: string;
  signName: string;
  templateCode: string;
  /** 模板变量,PNVS 约定验证码占位符为 ##code## */
  templateParam?: string;
  /** 验证码有效期(秒),缺省 300 */
  validTimeSeconds?: number;
  /** 同号重发间隔(秒),缺省 60 */
  intervalSeconds?: number;
  /** 验证码位数 4-8,缺省 6 */
  codeLength?: number;
  outId?: string;
}

export type SendVerifyCodeResult =
  | { ok: true; bizId: string | null; requestId: string | null }
  | { ok: false; reason: SmsFailureReason; code: string | null; message: string };

export type CheckVerifyCodeResult =
  | { ok: true }
  | {
      ok: false;
      /** mismatch = 码错/过期(正常业务失败);其余同 SmsFailureReason */
      reason: "mismatch" | SmsFailureReason;
      code: string | null;
      message: string;
    };

export interface SmsProvider {
  sendVerifyCode(input: SendVerifyCodeInput): Promise<SendVerifyCodeResult>;
  checkVerifyCode(input: { phone: string; code: string }): Promise<CheckVerifyCodeResult>;
}

/** 服务商业务码归类(阿里云 PNVS 返回码前缀 isv. 为业务错误) */
export function classifyProviderCode(code: string | null | undefined): SmsFailureReason {
  if (!code) return "provider_error";
  const c = code.toLowerCase();
  if (c.includes("limit") || c.includes("frequen") || c.includes("throttl")) return "rate_limited";
  if (c.includes("amount") || c.includes("balance") || c.includes("quota"))
    return "quota_exhausted";
  // accesskey / permission / forbidden:凭证或授权的配置问题(2026-10-31 真实
  // SDK 探针实证 InvalidAccessKeyId.NotFound 曾被误归 provider_error,让运维
  // 分不清「去配置页改密钥」还是「重试即可」)
  if (
    c.includes("sign") ||
    c.includes("template") ||
    c.includes("param") ||
    c.includes("auth") ||
    c.includes("accesskey") ||
    c.includes("permission") ||
    c.includes("forbidden")
  )
    return "config_invalid";
  return "provider_error";
}
