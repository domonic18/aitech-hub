/**
 * 博主/平台管理共享业务错误(M8 批③):bloggers-admin 与 social-platform-admin
 * 共用,独立小文件避免两者循环导入。
 */

export type BloggerAdminErrorCode =
  | "not_found"
  | "duplicate"
  | "enabled" // 两步武装删除:启用中禁物理删
  | "disabled" // 博主或平台停用,拒绝手动采集
  | "gateway" // 网关不可达/业务失败
  | "cookie_key"; // APP_COOKIE_ENC_KEY 未配置

/** 业务错误 → 路由按码映射 HTTP 状态(同 ChannelAdminError 模式) */
export class BloggerAdminError extends Error {
  constructor(
    public code: BloggerAdminErrorCode,
    message: string,
  ) {
    super(message);
  }
}
