/**
 * embedding 客户端(M20 批①,arch/04 §3.2 混合检索):openai 协议 /embeddings,
 * 供应商示例智谱 embedding-3(dimensions 1024)。错误语义与 llm-client 同源
 * (AiClientError:unsupported/http/timeout/business);usage 回读 prompt_tokens,
 * tokensOut 恒 0(台账读侧注意除零)。只支持 openai 协议——绑定 embedding 角色的
 * 模型行 protocol 须为 openai(anthropic 无 embedding 端点)。
 */
import { AI_PROTOCOL_OPENAI } from "./constants";
import { AiClientError } from "./errors";
import { type ChatUsage, parseChatUsage } from "./llm-client";

/** 单次请求文本条数上限(供应商批请求上限不一,保守 16;调用方分批) */
export const EMBED_BATCH_SIZE = 16;

export interface EmbedInput {
  /** 仅 openai(anthropic 无 embedding 端点) */
  protocol: string;
  baseUrl: string | null;
  modelId: string;
  apiKey: string | null;
  timeoutSec: number;
  /** 批文本(长度 ≤ EMBED_BATCH_SIZE;空数组直接短路返回) */
  texts: string[];
  /** 目标维度(服务端按此返回;返回长度不符 = 契约漂移) */
  dims: number;
}

export interface EmbedResult {
  vectors: number[][];
  usage: ChatUsage;
}

function httpError(status: number, bodyText: string): AiClientError {
  return new AiClientError(
    "http",
    `HTTP ${status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ""}`,
  );
}

/** 响应向量规整(纯函数,单测锚点):条数对齐 + 维度校验,异常一律契约漂移 */
export function parseEmbedResponse(
  bodyText: string,
  expectCount: number,
  dims: number,
): { vectors: number[][]; usage: ChatUsage } {
  let body: unknown = null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new AiClientError("business", "2xx 响应非 JSON(契约漂移)");
  }
  const b = body as { data?: unknown; usage?: unknown } | null;
  if (!Array.isArray(b?.data) || b.data.length !== expectCount) {
    throw new AiClientError("business", `响应向量条数不符(契约漂移,期望 ${expectCount})`);
  }
  const vectors: number[][] = [];
  for (const item of b.data) {
    const vec = (item as { embedding?: unknown }).embedding;
    if (
      !Array.isArray(vec) ||
      vec.length !== dims ||
      !vec.every((n) => typeof n === "number" && Number.isFinite(n))
    ) {
      throw new AiClientError("business", `响应向量维度/数值不符(契约漂移,期望 ${dims} 维)`);
    }
    vectors.push(vec);
  }
  return { vectors, usage: parseChatUsage(b.usage) };
}

export async function embedTexts(input: EmbedInput): Promise<EmbedResult> {
  if (input.protocol !== AI_PROTOCOL_OPENAI) {
    throw new AiClientError("unsupported", `embedding 协议不支持(${input.protocol})`);
  }
  if (!input.baseUrl) throw new AiClientError("unsupported", "embedding Base URL 未配置");
  if (input.texts.length === 0) return { vectors: [], usage: { tokensIn: 0, tokensOut: 0 } };
  if (input.texts.length > EMBED_BATCH_SIZE) {
    throw new AiClientError("unsupported", `批请求超上限(≤${EMBED_BATCH_SIZE})`);
  }

  let res: Response;
  try {
    res = await fetch(`${input.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: input.modelId,
        input: input.texts,
        dimensions: input.dims,
      }),
      signal: AbortSignal.timeout(input.timeoutSec * 1000),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new AiClientError("timeout", `embedding 超时 ${input.timeoutSec}s`);
    }
    throw new AiClientError("http", err instanceof Error ? err.message : String(err));
  }
  if (!res.ok) {
    throw httpError(res.status, await res.text().catch(() => ""));
  }
  return parseEmbedResponse(await res.text(), input.texts.length, input.dims);
}
