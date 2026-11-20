/**
 * 模型支持的 API 协议(策展规则;纯常量、零依赖、零 env)。
 *
 * 为什么是策展而不是采集:牌价页只报价,不写「这家的接口长什么样」——协议是
 * 平台侧的接入口事实(同一个模型换家供应商,能用的协议就可能不同),采集页
 * 拿不到,只能按官方文档逐家核。
 *
 * 口径:**只标有官方文档可证的**;核不出 → 空(页面不显示协议),不猜。
 * 依据(官方文档,逐条):
 * - 阿里云百炼:OpenAI 兼容(help.aliyun.com/zh/model-studio/compatible-with-openai)
 *   + Anthropic 兼容 Messages(docs.bailian.console.aliyun.com/zh/model-studio/anthropic-api-messages)
 * - 火山引擎方舟:OpenAI 兼容(volcengine.com/docs/ark/compatible-with-openai-sdk)
 *   + Anthropic 兼容端点(ark.cn-beijing.volces.com/api/compatible,官方「其他工具」页所载)
 * - 腾讯云混元:OpenAI 兼容(cloud.tencent.com/document/product/1729/111007)
 *   + Anthropic 兼容(cloud.tencent.com/document/product/1729/111007 所列 anthropic/v1/messages)
 * - 硅基流动:OpenAI 兼容 + Claude 模型走 Anthropic 兼容端点
 *   (docs.siliconflow.cn/cn/usercases/use-siliconcloud-in-ClaudeCode)
 * - Kimi / DeepSeek:OpenAI 兼容(platform.moonshot.cn/docs/api/chat、api-docs.deepseek.com)
 * - 词元所等聚合挂牌平台:协议由第三方供应方定 → 不标
 */

/** 协议标识(与站内 ai_model.protocol 同词表:openai / anthropic) */
export type ApiProtocol = "openai" | "anthropic";

/** 协议中文标签(前台角标 / 后台展示共用) */
export const PROTOCOL_LABELS: Record<ApiProtocol, string> = {
  openai: "OpenAI 兼容",
  anthropic: "Anthropic 兼容",
};

interface ProtocolRule {
  /** 该平台所有模型都支持的协议 */
  base: ApiProtocol[];
  /** 仅命中该模型的行额外支持 Anthropic(官方文档只覆盖这类模型时) */
  anthropicModels?: RegExp;
}

/** 厂商规范键 → 协议规则(键见 provider-registry.ts 的 PROVIDER_SEEDS) */
const PROTOCOL_RULES: Record<string, ProtocolRule> = {
  deepseek: { base: ["openai"] },
  moonshot: { base: ["openai"] },
  "aliyun-bailian": { base: ["openai", "anthropic"] },
  "volcengine-ark": { base: ["openai", "anthropic"] },
  "tencent-cloud": { base: ["openai", "anthropic"] },
  siliconflow: { base: ["openai"], anthropicModels: /claude/i },
};

/** 行支持的协议(空数组 = 未标注,不是「不支持」) */
export function resolveApiProtocols(providerKey: string | null, modelKey: string): ApiProtocol[] {
  if (providerKey === null) return [];
  const rule = PROTOCOL_RULES[providerKey];
  if (rule === undefined) return [];
  const out = [...rule.base];
  if (rule.anthropicModels !== undefined && rule.anthropicModels.test(modelKey)) {
    out.push("anthropic");
  }
  return out;
}

/** 协议展示文案(「OpenAI 兼容 · Anthropic 兼容」;空 → 空串) */
export function protocolsLabel(protocols: readonly ApiProtocol[]): string {
  return protocols.map((p) => PROTOCOL_LABELS[p]).join(" · ");
}
