/**
 * 短信场景与 PNVS 预置模板编码(M65 P1:账号中心绑定 / 换绑手机号)。
 *
 * 纯声明零 IO——客户端表单岛与服务端 lib 共用同一真相源(同 account-schema
 * 纪律)。模板编码是阿里云号码认证服务**预置**的固定值,不随后台「登录模板」
 * 配置漂移:`user_sms_config.template_code` 只作用于登录/注册(100001)。
 *
 * 场景语义:
 * - `bind`       当前无手机号 → 发往**新号**(100004 绑定新手机号)
 * - `rebind_old` 当前有手机号 → 发往**当前号**(100005 验证绑定手机号),通过后
 *                在 Redis 置 10 分钟一次性标记,换绑第二步凭此放行
 * - `rebind_new` 已通过第一步 → 发往**新号**(100002 修改绑定手机号)并落库
 *
 * 两步换绑而非一步:改绑等价于换掉一个可登录凭据,与改密码要验旧密码同一
 * 安全口径;若会话被盗,攻击者单凭 cookie 无法把账号改绑到自己的号码。
 */
import { z } from "zod";

import { PHONE_RE } from "@/lib/auth/rules";

export const SMS_TEMPLATE = {
  login: "100001",
  rebindNew: "100002",
  resetPassword: "100003",
  bindNew: "100004",
  verifyCurrent: "100005",
} as const;

export const PHONE_SCENES = ["bind", "rebind_old", "rebind_new"] as const;
export type PhoneScene = (typeof PHONE_SCENES)[number];

/** 换绑第二步完成前必须停留的最长窗口(秒) */
export const PHONE_REBIND_WINDOW_SECONDS = 600;

/** rebind_old 的目标号由服务端从会话取,不收客户端输入(防越权验他人的号) */
export function sceneNeedsNewPhone(scene: PhoneScene): boolean {
  return scene !== "rebind_old";
}

const phoneField = z.string().trim().regex(PHONE_RE, "手机号格式不正确").optional();

function requirePhoneWhenNeeded<T extends { scene: PhoneScene; phone?: string }>(
  value: T,
  ctx: z.RefinementCtx,
): void {
  if (sceneNeedsNewPhone(value.scene) && !value.phone) {
    ctx.addIssue({ code: "custom", message: "请填写手机号", path: ["phone"] });
  }
}

/** POST /api/account/phone/code 入参 */
export const phoneCodeSchema = z
  .object({ scene: z.enum(PHONE_SCENES), phone: phoneField })
  .superRefine(requirePhoneWhenNeeded);

/** POST /api/account/phone/verify 入参 */
export const phoneVerifySchema = z
  .object({
    scene: z.enum(PHONE_SCENES),
    phone: phoneField,
    code: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/, "验证码格式不正确"),
  })
  .superRefine(requirePhoneWhenNeeded);

export type PhoneBindErrorCode =
  | "not_found"
  | "phone_taken"
  | "same_phone"
  | "admin_forbidden"
  | "flow_required"
  | "has_phone"
  | "no_phone"
  | "invalid_new_phone"
  | "inactive";

export class PhoneBindError extends Error {
  constructor(
    public code: PhoneBindErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** 错误码 → HTTP 状态(端点共用,单一真相源) */
export const PHONE_BIND_ERROR_STATUS = {
  not_found: 404,
  phone_taken: 409,
  same_phone: 400,
  admin_forbidden: 403,
  flow_required: 409,
  has_phone: 400,
  no_phone: 400,
  invalid_new_phone: 400,
  inactive: 403,
} as const satisfies Record<PhoneBindErrorCode, number>;
