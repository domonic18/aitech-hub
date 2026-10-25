/** LLM chat 探针(M47 批D 自 probe.ts 拆出):2xx 即通;max_tokens=1 最小成本 */
import { logger } from "../logger";
import { AI_PROTOCOL_ANTHROPIC, AI_PROTOCOL_OPENAI } from "./constants";
import { authHeaders, runProbe, type ProbeInput, type ProbeResult } from "./probe-shared";

export async function probeLlm(input: ProbeInput): Promise<ProbeResult> {
  if (input.protocol !== AI_PROTOCOL_OPENAI && input.protocol !== AI_PROTOCOL_ANTHROPIC) {
    logger.info({ event: "ai_probe.skipped", kind: "llm", protocol: input.protocol });
    return {
      ok: false,
      latencyMs: 0,
      detail: "该协议暂不支持连通性测试(仅 openai/anthropic)",
      skipped: true,
    };
  }
  if (!input.baseUrl) return { ok: false, latencyMs: 0, detail: "Base URL 未配置" };
  const messages = [{ role: "user" as const, content: "ping" }];
  const body = JSON.stringify({ model: input.modelId, max_tokens: 1, messages });
  const url =
    input.protocol === AI_PROTOCOL_ANTHROPIC
      ? `${input.baseUrl}/v1/messages`
      : `${input.baseUrl}/chat/completions`;
  const headers: Record<string, string> =
    input.protocol === AI_PROTOCOL_ANTHROPIC
      ? {
          "content-type": "application/json",
          "x-api-key": input.apiKey ?? "",
          "anthropic-version": "2023-06-01",
        }
      : { "content-type": "application/json", ...authHeaders(input.apiKey) };
  const raw = await runProbe(url, { method: "POST", headers, body });
  return { ok: raw.ok, latencyMs: raw.latencyMs, detail: raw.detail };
}
