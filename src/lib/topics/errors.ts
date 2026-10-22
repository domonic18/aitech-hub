/**
 * 专题域错误类型(M42 批②从 repo 拆出,供 repo / materials 共用):code 供
 * HTTP 映射与工具层人话化,message 直接面向运营者可读。
 */
export type TopicErrorCode = "not_found" | "conflict" | "invalid_transition" | "invalid_material";

export class TopicError extends Error {
  constructor(
    readonly code: TopicErrorCode,
    message: string,
  ) {
    super(message);
  }
}
