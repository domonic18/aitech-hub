/**
 * 飞书免登域错误(M29 批①):code→HTTP 状态映射 feishuErrorStatus 由路由层
 * 统一转换;upstream(飞书 OpenAPI 失败/网络)对外一律模糊提示,细节仅日志。
 */
export type FeishuErrorCode = "invalid" | "not_found" | "conflict" | "disabled" | "upstream";

export class FeishuError extends Error {
  constructor(
    readonly code: FeishuErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FeishuError";
  }
}

export function feishuErrorStatus(code: FeishuErrorCode): number {
  switch (code) {
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    case "invalid":
      return 400;
    case "disabled":
      return 403;
    case "upstream":
      return 502;
  }
}
