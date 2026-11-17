/**
 * agent 护栏判定(纯函数,零依赖,单测锚点)。
 *
 * **口径分离(2026-11-17 站长裁定)**:三个闸各管一件事,不再互相顶替——
 * - **单次模型调用闸**(`callTokens`):任一次调用的 prompt+completion 上限,
 *   防单次超大上下文(读侧无瘦身时,长会话的 prompt 会一路涨);
 * - **单轮工具调用闸**(`toolCalls`):一轮内的工具调用次数上限(后台可调);
 * - **用量闸**(`tokens`):**真实消耗**口径的上限(各次模型调用用量之和),
 *   会话累计闸在路由层前置(429)、单轮闸在此兜底。
 *
 * **此前为什么误触**:旧实现把「一轮内各次调用的 prompt 之和」直接与会话预算
 * 50k 比。每轮模型调用都把「历史 + 工具结果」全量重发,同一段历史被重复计数
 * N 次——生产实测一次追问 4 次调用累加 48 487(单次真实仅 ~16k),一轮就吃掉
 * 会话预算的 96%,run 被腰斩、计划条任务一个都没跑完。
 */

export interface GuardLimits {
  /** 单次模型调用闸:单次 prompt+completion 上限 */
  callTokens: number;
  /** 单轮工具调用闸 */
  toolCalls: number;
  /** 用量闸(真实消耗口径) */
  tokens: number;
}

/** 命中的闸 */
export type GuardTrip = "call_tokens" | "tool_calls" | "tokens";

export interface GuardState {
  /** 本轮真实消耗(各次模型调用用量之和) */
  runTokens: number;
  /** 单次模型调用最大用量(prompt+completion) */
  maxCallTokens: number;
  /** 本轮工具调用次数 */
  toolCalls: number;
}

/** 判定:命中返回闸名,全通过返回 null(顺序=优先级) */
export function evaluateGuard(state: GuardState, limits: GuardLimits): GuardTrip | null {
  if (state.maxCallTokens > limits.callTokens) return "call_tokens";
  if (state.toolCalls > limits.toolCalls) return "tool_calls";
  if (state.runTokens > limits.tokens) return "tokens";
  return null;
}

/** 命中闸的人话说明(前端直显——精确原因不丢) */
export function guardMessage(trip: GuardTrip): string {
  switch (trip) {
    case "call_tokens":
      return "本轮上下文过大(单次模型输入超出上限),已主动收束。建议新建会话继续。";
    case "tool_calls":
      return "本条回复的工具调用已达上限,已主动收束。";
    case "tokens":
      return "本条回复的用量已达上限,已主动收束。";
  }
}

// ---------- usage 归属(把逐帧 usage 归到「每次模型调用」)----------

/**
 * usage 归属状态。
 *
 * 生产实测形态:provider **每次模型调用只报一帧** usage(输入量逐次增长
 * 7 212 → 10 501 → 14 023 → 15 917,一帧=一次调用)。另需容忍「每 chunk
 * 累计上报」的形态:相邻两帧输入量相同且其间没有 stop → 同一调用的重复上报,
 * 只补差额不重复计入总量。
 */
export interface UsageAccumulator {
  /** 本轮真实输入用量(各次模型调用输入之和) */
  tokensIn: number;
  /** 本轮真实输出用量 */
  tokensOut: number;
  /** 单次调用最大用量(prompt+completion) */
  maxCallTokens: number;
  /** 最近一帧的输入/输出量(识别累计上报) */
  lastInput: number | null;
  lastOutput: number | null;
  /** 当前调用已计入的用量(累计上报时取大值) */
  lastCallTokens: number;
  /** 自上一帧 usage 以来是否出现过 stop(调用边界) */
  sawStop: boolean;
}

export function createUsageAccumulator(): UsageAccumulator {
  return {
    tokensIn: 0,
    tokensOut: 0,
    maxCallTokens: 0,
    lastInput: null,
    lastOutput: null,
    lastCallTokens: 0,
    sawStop: false,
  };
}

/** 本轮真实消耗(输入+输出) */
export function runTokensOf(acc: UsageAccumulator): number {
  return acc.tokensIn + acc.tokensOut;
}

/** 吸收一帧 usage */
export function absorbUsage(acc: UsageAccumulator, input: number, output: number): void {
  const total = input + output;
  const isNewCall = acc.sawStop || acc.lastInput === null || input !== acc.lastInput;
  if (isNewCall) {
    acc.tokensIn += input;
    acc.tokensOut += output;
    acc.lastCallTokens = total;
  } else {
    // 同一调用的累计上报:只补差额(累计值单调增,增量即新增用量)
    if (input > (acc.lastInput ?? 0)) acc.tokensIn += input - (acc.lastInput ?? 0);
    if (output > (acc.lastOutput ?? 0)) acc.tokensOut += output - (acc.lastOutput ?? 0);
    if (total > acc.lastCallTokens) acc.lastCallTokens = total;
  }
  if (acc.lastCallTokens > acc.maxCallTokens) acc.maxCallTokens = acc.lastCallTokens;
  acc.lastInput = input;
  acc.lastOutput = output;
  acc.sawStop = false;
}

/** 标记调用边界(模型轮收尾帧到达) */
export function markCallEnd(acc: UsageAccumulator): void {
  acc.sawStop = true;
}
