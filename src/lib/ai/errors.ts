/**
 * AI 服务管理共享业务错误(M8 批⑥):models/asr/bindings-admin 共用,
 * 独立小文件避免互相循环导入(先例 telegram/bloggers-errors.ts)。
 * M9 起同时承载管道侧客户端错误(asr-client/llm-client)。
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

/**
 * 管道侧客户端错误(M9 解读管道):kind 归因供 processor 分流——
 * unsupported=协议/配置不支持(不重试)、http=网络层/HTTP 状态、
 * business=2xx 业务错(供应商包装)、timeout=超时。
 */
export type AiClientErrorKind = "unsupported" | "http" | "business" | "timeout";

export class AiClientError extends Error {
  constructor(
    public kind: AiClientErrorKind,
    message: string,
  ) {
    super(message);
  }
}
