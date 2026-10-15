/**
 * 专题工具共享基元(技术债批⑤ 自 topic-tools 拆分防循环):admin 纵深防御
 * deny 载荷与 TopicError 人话化,topic-tools 与 topic-draft-tool 同用。
 */
import { TopicError } from "../topics/repo";

import { adminThreadDeny } from "./admin-thread";

/** 纵深防御收口(M27 批⑧-b 上提 admin-thread 共用;deny 固定 topic 域) */
export const denyPayload = (threadId: unknown): string => adminThreadDeny(threadId, "topic");

/** TopicError(不存在等)归人话;其余原样上抛由 run 层收束 */
export function humanizeTopicError(e: unknown): string | null {
  return e instanceof TopicError ? e.message : null;
}
