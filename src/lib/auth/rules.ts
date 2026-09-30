/**
 * 凭据表单规则(arch/05-services §3.1):手机号格式与密码强度。
 * 纯函数零依赖——admin 脚本、登录 Zod schema、日志脱敏共用同一真相源,单测钉行为。
 */

/** 11 位大陆手机号(1[3-9] 开头) */
export const PHONE_RE = /^1[3-9]\d{9}$/;

export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt 输入上限 72 字节,超出静默截断,必须在边界校验拦下 */
export const PASSWORD_MAX_LENGTH = 72;

/** 密码强度:≥8 位且同时含字母与数字;返回错误文案,null 表示通过 */
export function validatePassword(pwd: string): string | null {
  if (pwd.length < PASSWORD_MIN_LENGTH) return "密码至少 8 位";
  if (pwd.length > PASSWORD_MAX_LENGTH) return "密码最长 72 字符(bcrypt 输入上限)";
  if (!/[A-Za-z]/.test(pwd) || !/\d/.test(pwd)) return "密码须同时包含字母与数字";
  return null;
}
