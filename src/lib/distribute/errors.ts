/**
 * 分发域业务错误(M17 批①):wechat-config/records/sync 共用,
 * 独立小文件避免互相循环导入(先例 ai/errors.ts)。
 */

export type DistributeErrorCode =
  | "not_found"
  | "duplicate"
  | "invalid" // 校验不过(旧文/缺封面/超限等)
  | "disabled" // 渠道未启用/未就绪
  | "pending"; // 已在同步队列,幂等拒绝

/** 业务错误 → 路由按码映射 HTTP 状态(同 AiAdminError 模式) */
export class DistributeError extends Error {
  constructor(
    public code: DistributeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** 路由侧统一映射:not_found→404,duplicate→409,其余→400 */
export function distributeErrorStatus(code: DistributeErrorCode): number {
  if (code === "not_found") return 404;
  if (code === "duplicate") return 409;
  return 400;
}
