/**
 * B站直连错误分类(M25,分类法同 github/api.ts):风控与不可达分开——
 * 风控走退避重试(constants 纪律),不可达/契约漂移按词失败留痕不弃整轮。
 */

/** 风控拦截:HTTP 412 或业务码 -412/-352;调用方 15s 退避重试(纪律见 constants) */
export class BiliRiskControlError extends Error {
  readonly code: number | null;

  constructor(message: string, code: number | null = null) {
    super(message);
    this.name = "BiliRiskControlError";
    this.code = code;
  }
}

/** 接口不可达:网络错误/超时/非 2xx(退避重试价值低,按词失败留痕) */
export class BiliApiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BiliApiUnavailableError";
  }
}

/** 响应形态偏离契约(envelope 解析失败/业务码异常但非风控;批④ 真机验收关注信号) */
export class BiliApiUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BiliApiUpstreamError";
  }
}
