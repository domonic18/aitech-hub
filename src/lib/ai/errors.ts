/**
 * AI 服务管理共享业务错误(M8 批⑥):models/asr/bindings-admin 共用,
 * 独立小文件避免互相循环导入(先例 telegram/bloggers-errors.ts)。
 */

export type AiAdminErrorCode =
  | "not_found"
  | "duplicate"
  | "bound" // 两步武装删除:被任务绑定引用,先解绑
  | "invalid" // 校验不过(purposes 不匹配/主备相同等)
  | "disabled"; // 绑定/解析目标模型已停用

/** 业务错误 → 路由按码映射 HTTP 状态(同 BloggerAdminError 模式) */
export class AiAdminError extends Error {
  constructor(
    public code: AiAdminErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** 路由侧统一映射:not_found→404,duplicate|bound→409,其余→400 */
export function aiErrorStatus(code: AiAdminErrorCode): number {
  if (code === "not_found") return 404;
  if (code === "duplicate" || code === "bound") return 409;
  return 400;
}
