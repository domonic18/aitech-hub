/**
 * 日志脱敏(arch/05-services §3.1):手机号掩码,auth 事件与 admin 脚本共用。
 * 纯函数,便于单测;非 11 位规范手机号原样返回"***"(不猜格式,不泄漏片段)。
 */
import { PHONE_RE } from "./rules";

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "***";
  if (!PHONE_RE.test(phone)) return "***";
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

/**
 * 邮箱掩码(M21 批⓪):local 首字符 + *** + @域名;无 @ 或空段原样返回"***"
 * (不猜格式,不泄漏片段)。auth/email 事件日志共用。
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "***";
  const at = email.indexOf("@");
  if (at <= 0 || at === email.length - 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}
