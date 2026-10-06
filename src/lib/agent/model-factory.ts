/**
 * Agent 模型工厂(K2.5):search 角色绑定 → LangChain ChatModel 实例。
 * 绑定解析复用 resolveAiModel(AI_PURPOSE_SEARCH)(主力/备用/配额输入全现成,
 * arch/04 §3.3 零桥接);台账记独立角色 search_agent(与答案卡计数互不侵占)。
 * protocol 分流:openai → ChatOpenAI(custom baseURL,兼容 DeepSeek/GLM/Qwen
 * 等聚合网关);anthropic → ChatAnthropic;其他协议构造即拒(消费方降级)。
 */
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";

import { AI_PROTOCOL_ANTHROPIC, AI_PROTOCOL_OPENAI, AI_PURPOSE_SEARCH } from "../ai/constants";
import { resolveAiModel, type ResolvedAiModel } from "../ai/resolver";

/** 协议不支持错误(run.ts 捕获 → unavailable 人话;同 llm-client 拒绝口径) */
export class AgentModelError extends Error {}

function openaiModel(m: ResolvedAiModel): ChatOpenAI {
  return new ChatOpenAI({
    model: m.modelId,
    apiKey: m.apiKey ?? "not-set",
    temperature: 0.3,
    timeout: m.timeoutSec * 1000,
    maxRetries: 0, // 重试与主备切换由绑定解析层负责,客户端不重试防重复计费
    configuration: { baseURL: m.baseUrl ?? undefined },
  });
}

function anthropicModel(m: ResolvedAiModel): ChatAnthropic {
  return new ChatAnthropic({
    model: m.modelId,
    apiKey: m.apiKey ?? "not-set",
    temperature: 0.3,
    maxRetries: 0,
    ...(m.baseUrl ? { anthropicApiUrl: m.baseUrl } : {}),
    // anthropic 协议超时经 SDK ClientOptions 透传(无顶层 timeout 字段)
    clientOptions: { timeout: m.timeoutSec * 1000 },
  });
}

/**
 * 解析 search 绑定并构造 ChatModel;无绑定/协议不支持抛 AgentModelError。
 * 每次调用现解析(绑定/启停 admin 侧即时生效;构造轻量,不值得缓存)。
 */
export async function resolveAgentModel(): Promise<{
  model: ChatOpenAI | ChatAnthropic;
  resolved: ResolvedAiModel;
}> {
  const m = await resolveAiModel(AI_PURPOSE_SEARCH);
  if (!m) throw new AgentModelError("no_binding");
  if (m.protocol === AI_PROTOCOL_OPENAI) return { model: openaiModel(m), resolved: m };
  if (m.protocol === AI_PROTOCOL_ANTHROPIC) return { model: anthropicModel(m), resolved: m };
  throw new AgentModelError(`unsupported_protocol:${m.protocol}`);
}
