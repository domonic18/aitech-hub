/**
 * 认证层零依赖常量:本文件不 import 任何模块(尤其 env/jose)——
 * middleware(边缘环境)与客户端组件均可安全引用;防伪逻辑仍各自在 session/guard。
 */

/** 会话 Cookie 名;session.ts re-export 保持 M3 import 契约 */
export const ACCESS_COOKIE_NAME = "ah_at";

/** admin 登录页路径(middleware 预检跳转、guard 守卫回跳、顶栏退出回跳共用) */
export const ADMIN_LOGIN_PATH = "/admin/login";

/** admin 角色标识(user_accounts.role 为 VarChar(20) 非 Prisma enum,字面量唯一出处在此) */
export const ADMIN_ROLE = "admin";
