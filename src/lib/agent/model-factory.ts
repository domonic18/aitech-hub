/**
 * Agent 模型工厂(K2.5):search 角色绑定 → LangChain ChatModel 实例。
 * 绑定解析复用 resolveAiModel(AI_PURPOSE_SEARCH)(主力/备用/配额输入全现成,
 * arch/04 §3.3 零桥接);台账记独立角色 search_agent(与答案卡计数互不侵占)。
 * protocol 分流:openai → ChatOpenAI(custom baseURL,兼容 DeepSeek/GLM/Qwen
 * 等聚合网关);anthropic → ChatAnthropic;其他协议构造即拒(消费方降级)。
 * 输出预算/供应商扩展(2026-10-17:max_tokens 截断静默中断根修)只住台账
 * extraParams,代码零数值默认——max_tokens → maxTokens(双协议),
 * output_config(如 MiniMax effort 思考深度,缺省 max)→ outputConfig(仅
 * anthropic,langchain 原生透传请求体);未配置时 langchain 按模型名兜底
 * (未知模型 4096,思考型模型易静默截断),故缺失即 warn 提示台账补配。
 */
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";

import { AI_PROTOCOL_ANTHROPIC, AI_PROTOCOL_OPENAI, AI_PURPOSE_SEARCH } from "../ai/constants";
import { hasExtraMaxTokens, readExtraMaxTokens, readExtraOutputConfig } from "../ai/extra-params";
import { resolveAiModel, type ResolvedAiModel } from "../ai/resolver";
import { logger } from "../logger";

/** 协议不支持错误(run.ts 捕获 → unavailable 人话;同 llm-client 拒绝口径) */
export class AgentModelError extends Error {}

/** extraParams → 构造参数(纯函数,单测锚点):类型门通过才带上,配错型 warn 不静默吞 */
export function extraModelParams(m: ResolvedAiModel): {
  maxTokens?: number;
  outputConfig?: Record<string, unknown>;
} {
  const out: { maxTokens?: number; outputConfig?: Record<string, unknown> } = {};
  const maxTokens = readExtraMaxTokens(m.extraParams);
  if (maxTokens !== null) {
    out.maxTokens = maxTokens;
  } else if (hasExtraMaxTokens(m.extraParams)) {
    logger.warn({
      event: "agent.model_extra_params_invalid",
      modelId: m.id,
      key: "max_tokens",
    });
  }
  const outputConfig = readExtraOutputConfig(m.extraParams);
  if (outputConfig !== null) {
    if (m.protocol === AI_PROTOCOL_ANTHROPIC) out.outputConfig = outputConfig;
    else
      logger.warn({
        event: "agent.model_extra_params_ignored",
        modelId: m.id,
        key: "output_config",
      });
  }
  return out;
}

/** anthropic 协议未配 max_tokens 的截断风险告警(每 run 一次,量级低) */
function warnMissingMaxTokens(m: ResolvedAiModel): void {
  if (m.protocol !== AI_PROTOCOL_ANTHROPIC || readExtraMaxTokens(m.extraParams) !== null) return;
  logger.warn({
    event: "agent.model_max_tokens_unconfigured",
    modelId: m.id,
    modelKey: m.modelId,
  });
}

function openaiModel(m: ResolvedAiModel): ChatOpenAI {
  return new ChatOpenAI({
    model: m.modelId,
    apiKey: m.apiKey ?? "not-set",
    temperature: 0.3,
    timeout: m.timeoutSec * 1000,
    maxRetries: 0, // 重试与主备切换由绑定解析层负责,客户端不重试防重复计费
    configuration: { baseURL: m.baseUrl ?? undefined },
    ...extraModelParams(m),
  });
}

function anthropicModel(m: ResolvedAiModel): ChatAnthropic {
  warnMissingMaxTokens(m);
  return new ChatAnthropic({
    model: m.modelId,
    apiKey: m.apiKey ?? "not-set",
    temperature: 0.3,
    maxRetries: 0,
    ...(m.baseUrl ? { anthropicApiUrl: m.baseUrl } : {}),
    // anthropic 协议超时经 SDK ClientOptions 透传(无顶层 timeout 字段)
    clientOptions: { timeout: m.timeoutSec * 1000 },
    ...extraModelParams(m),
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
