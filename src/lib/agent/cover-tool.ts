/**
 * 封面候选 HITL 契约(M31 验收反馈,hitl.ts 同款零依赖收口):编辑页 agent
 * 生成封面候选后以 interrupt 挂起,前端 CoverCandidatesCard 渲染候选预览,
 * 管理员点「入库」/「全部放弃」经 Command({resume}) 回灌;工具体在 adopt
 * 分支才真正 uploadMedia 入媒体库(hold 生图不落库)。机制 = propose_edits
 * 同款工体内裸调 interrupt(),载荷形状完全自控。
 */

/** 工具名(工具面与 interrupt.value.kind 同源) */
export const AGENT_COVER_CANDIDATES_TOOL = "generate_cover_candidates";

/** 候选预览项(id 供入库回传;url 为预览接口,会话鉴权) */
export interface AgentCoverCandidate {
  id: string;
  url: string;
}

/** interrupt 载荷(kind 冗余一个防串线) */
export interface AgentCoverPayload {
  kind: typeof AGENT_COVER_CANDIDATES_TOOL;
  prompt: string;
  candidates: AgentCoverCandidate[];
}

/** 用户决策的 resume 值(adopt 必带 candidateId;discard 弃整批) */
export interface AgentCoverResume {
  decision: "adopt" | "discard";
  candidateId?: string;
}

/** Command resume 形状(stream 路由 bodySchema 与前端构造共用) */
export interface AgentCoverResumeCommand {
  resume: AgentCoverResume;
}

/** 从 interrupt 状态值解析载荷(kind 不符或形状缺损返 null,调用方落兜底卡) */
export function parseAgentCoverInterrupt(value: unknown): AgentCoverPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.kind !== AGENT_COVER_CANDIDATES_TOOL) return null;
  if (typeof v.prompt !== "string") return null;
  if (!Array.isArray(v.candidates) || v.candidates.length === 0) return null;
  const candidates: AgentCoverCandidate[] = [];
  for (const c of v.candidates) {
    if (typeof c !== "object" || c === null) return null;
    const item = c as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.url !== "string") return null;
    candidates.push({ id: item.id, url: item.url });
  }
  return { kind: AGENT_COVER_CANDIDATES_TOOL, prompt: v.prompt, candidates };
}

/** 构造 resume 命令体(runtime sendCommand → POST body.command) */
export function buildCoverResumeCommand(resume: AgentCoverResume): AgentCoverResumeCommand {
  return { resume };
}
