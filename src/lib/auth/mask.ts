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
