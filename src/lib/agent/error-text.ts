/**
 * 流式中断文案提取(零依赖,客户端可入 bundle)。
 *
 * 服务端在 SSE error 帧里已给出精确原因(护栏撞线 / 死端 / 异常),assistant-ui
 * 把它挂在消息 status.error 上;此前前端只渲染一句通用「响应已中断(护栏收束
 * 或服务异常)」,精确原因被丢弃,用户分不清是撞线还是服务挂。
 */

/** assistant-ui 消息 status 的最小形状(incomplete 分支) */
export interface IncompleteStatus {
  readonly type: "incomplete";
  readonly reason?: string;
  readonly error?: unknown;
}

/**
 * 从消息 status 取出人话原因;取不到返回 null(调用方落通用兜底文案)。
 * - status.error 为字符串 → 直接用;
 * - status.error 为对象且带 string 型 message → 用 message(服务端 error 帧契约);
 * - reason=cancelled(用户主动停) → 「已取消」。
 */
export function extractStreamErrorText(status: unknown): string | null {
  if (typeof status !== "object" || status === null) return null;
  const s = status as { reason?: unknown; error?: unknown };
  if (s.reason === "cancelled") return "已取消";
  const err = s.error;
  if (typeof err === "string") {
    const text = err.trim();
    return text === "" ? null : text;
  }
  if (typeof err === "object" && err !== null) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string") {
      const text = msg.trim();
      return text === "" ? null : text;
    }
  }
  return null;
}
