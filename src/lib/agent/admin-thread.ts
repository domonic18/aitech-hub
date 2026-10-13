/**
 * admin 工具纵深防御收口(M27 批⑧-b 自 topic-tools 上提共用):图侧工具面
 * 已按身份档分发(admin 独占),工具体内再验会话行归属是 admin——双防线,
 * 防工具经非 admin 图路径误入(fail-closed)。topic-tools 与编辑工具
 * (read_draft/propose_edits)共用同一真相源。
 */
import { prisma } from "../db";
import { logger } from "../logger";

/** 会话行归属校验(visitorId admin: 前缀;无行/他人行一律 false) */
export async function assertAdminThread(threadId: unknown): Promise<boolean> {
  if (typeof threadId !== "string" || threadId === "") return false;
  const session = await prisma.searchAgentSession.findUnique({
    where: { id: threadId },
    select: { visitorId: true },
  });
  return session?.visitorId.startsWith("admin:") ?? false;
}

/** 拒绝载荷(人话进模型;日志记事件不记正文,domain 区分工具域) */
export function adminThreadDeny(threadId: unknown, domain: string): string {
  logger.warn({
    event: "agent.admin_tool_denied",
    domain,
    threadId: typeof threadId === "string" ? threadId : undefined,
  });
  return JSON.stringify({ ok: false, error: "无权限:仅管理员会话可执行此操作" });
}
