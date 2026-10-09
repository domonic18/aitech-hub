/**
 * ask_user 结构化提问契约(K2.5 HITL,2026-10-09 验收反馈):agent 关键信息
 * 缺失时以 ask_user 工具发起中断,前端渲染交互卡片,回答经 Command({resume})
 * 回灌工具结果。本模块为零依赖契约收口(todos.ts 同款纪律):工具载荷、
 * resume 形状、interrupt 帧解析前后端共用——客户端 bundle 不得经 tools.ts
 * 拉入 prisma/deepagents,服务端也不该手写字符串字面量。机制选型:deepagents
 * TS 版 HITL 中间件(interruptOn)的 reject 决策会把回复合成 status:"error"
 * 的 ToolMessage(语义错),故在工具体内裸调 langgraph interrupt(),回传即
 * 正常结果消息,载荷形状完全自控。
 */

/** ask_user 工具名(工具面与 interrupt.value.kind 同源) */
export const AGENT_ASK_USER_TOOL = "ask_user";

/** interrupt 载荷(工具入参即载荷,kind 冗余一个防串线) */
export interface AgentAskUserPayload {
  kind: "ask_user";
  question: string;
  /** 候选选项(用户可直接点选;缺省 = 纯自由文本回答) */
  options?: string[];
}

/** 用户回答的 resume 值(interrupt() 在恢复后原样返回给工具体) */
export interface AgentAskUserResume {
  message: string;
  /** 命中的候选选项(自由文本回答时缺省) */
  option?: string;
}

/** Command resume 形状(stream 路由 bodySchema 与前端构造共用) */
export interface AgentAskUserResumeCommand {
  resume: AgentAskUserResume;
}

/**
 * 从 interrupt 状态值解析 ask_user 载荷(useLangGraphInterruptState().value
 * → 卡片数据)。kind 不符或形状缺损返 null,由调用方落通用兜底卡。
 */
export function parseAgentAskUserInterrupt(value: unknown): AgentAskUserPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.kind !== AGENT_ASK_USER_TOOL) return null;
  if (typeof v.question !== "string" || v.question.trim() === "") return null;
  const options = Array.isArray(v.options)
    ? v.options.filter((o): o is string => typeof o === "string" && o.trim() !== "")
    : undefined;
  return {
    kind: AGENT_ASK_USER_TOOL,
    question: v.question,
    ...(options && options.length > 0 ? { options } : {}),
  };
}

/** 构造 resume 命令体(runtime sendCommand → POST body.command) */
export function buildAskUserResumeCommand(resume: AgentAskUserResume): AgentAskUserResumeCommand {
  return { resume };
}
