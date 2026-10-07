/**
 * 采集失败根因人话(2026-10-07 验收反馈问题1):undici 对网络层失败统一抛
 * TypeError("fetch failed"),真实原因(ENOTFOUND/ECONNRESET/超时…)藏在
 * err.cause——原样入 BullMQ failedReason 只剩「fetch failed」,管理员无从
 * 判断哪个渠道因什么失败。本模块剥 cause 链翻译成短语;错误信息一律不含
 * URL(token 鉴权 feed 的凭证以 query 注入,见 rss.ts#applyToken,入日志即泄漏)。
 */

/** 常见 cause 错误码 → 人话(undici/connect 系;未收录码原样透出) */
const CAUSE_CODE_LABELS: Record<string, string> = {
  ENOTFOUND: "DNS 解析失败",
  EAI_AGAIN: "DNS 暂时不可解析",
  ECONNREFUSED: "连接被拒绝",
  ECONNRESET: "连接被对端重置",
  ETIMEDOUT: "连接超时",
  UND_ERR_CONNECT_TIMEOUT: "连接超时",
  UND_ERR_HEADERS_TIMEOUT: "响应头超时",
  EPROTO: "TLS/协议错误",
  CERT_HAS_EXPIRED: "TLS 证书已过期",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS 证书无法验证",
  DEPTH_ZERO_SELF_SIGNED_CERT: "TLS 自签证书",
};

/** 失败根因短语:剥 cause 错误码翻译;超时/限频类按 name 识别;其余原样透出 */
export function describeCrawlError(err: unknown): string {
  const base = err instanceof Error ? err.message : String(err);
  // AbortSignal.timeout 触发的 DOMException:TimeoutError(超时)/AbortError(中止)
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return `请求超时或中止(${err.name})`;
  }
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code ?? "";
    const label = CAUSE_CODE_LABELS[code];
    if (label) return `${base}:${label}(${code})`;
    if (code) return `${base}:${code} ${cause.message}`;
    return `${base}:${cause.message}`;
  }
  return base;
}
