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
  if (pwd.length < PASSWORD_MIN_LENGTH) return `密码至少 ${PASSWORD_MIN_LENGTH} 位`;
  if (pwd.length > PASSWORD_MAX_LENGTH) {
    return `密码最长 ${PASSWORD_MAX_LENGTH} 字符(bcrypt 输入上限)`;
  }
  if (!/[A-Za-z]/.test(pwd) || !/\d/.test(pwd)) return "密码须同时包含字母与数字";
  return null;
}

/** 用户名(M21 批⓪,D1 邮箱通道):3-30 位字母/数字/下划线/连字符,登录标识之一。
 *  大小写敏感(存储与登录一致,不折叠);legacy_username 仅审计留存不参与唯一约束。 */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
export const USERNAME_RE = /^[A-Za-z0-9_-]+$/;

export function validateUsername(name: string): string | null {
  if (name.length < USERNAME_MIN_LENGTH) return `用户名至少 ${USERNAME_MIN_LENGTH} 个字符`;
  if (name.length > USERNAME_MAX_LENGTH) return `用户名最长 ${USERNAME_MAX_LENGTH} 个字符`;
  if (!USERNAME_RE.test(name)) return "用户名仅限字母、数字、下划线、连字符";
  return null;
}

/** 邮箱(宽松实用型):local@domain 两段非空无空格;可达性靠验证邮件本身确认。
 *  存储一律小写折叠(注册时 lower,登录查找 lower),避免大小写双账号。 */
export const EMAIL_MAX_LENGTH = 254;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

export function validateEmail(email: string): string | null {
  if (email.length > EMAIL_MAX_LENGTH) return `邮箱最长 ${EMAIL_MAX_LENGTH} 个字符`;
  if (!EMAIL_RE.test(email) || !email.includes(".")) return "邮箱格式不正确";
  return null;
}
