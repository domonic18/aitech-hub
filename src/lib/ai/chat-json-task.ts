/**
 * LLM 结构化任务调用(M12 批③ 自 interpret-video 抽出):chatJson + JSON 契约
 * 解析,输出不成 JSON 就地重试一次;网络/HTTP/超时错误原样上抛给 BullMQ attempts。
 * interpret(视频)与 summarize(文字)两个编排器共用,契约解析器由调用方注入。
 * 批⑦:可选 role 入参——传入即逐次落 ai_usage_log(tokens/时长/status,
 * 备用模型=degraded;解析终败也落 failed 行),观测数据不反噬管道。
 */
import { AiClientError } from "./errors";
import { chatJson, type ChatUsage } from "./llm-client";
import type { ResolvedAiModel } from "./resolver";
import { recordAiUsage } from "./usage-log";

export type ParsedTask<T> = { ok: true; data: T } | { ok: false; error: string };

/** 输出不成 JSON 的重试次数(首次 + 1 重试;网络错误不在此层) */
const LLM_PARSE_RETRIES = 1;

export async function chatJsonTask<T>(
  model: ResolvedAiModel,
  parse: (raw: string) => ParsedTask<T>,
  system: string,
  user: string,
  /** 用量台账角色(interpret/summarize/…);缺省不落台账(seo-suggest 等复用方按需传) */
  usageRole?: string,
): Promise<T> {
  let lastParseError = "";
  let lastUsage: ChatUsage = { tokensIn: 0, tokensOut: 0 };
  for (let attempt = 0; attempt <= LLM_PARSE_RETRIES; attempt++) {
    const startedAt = Date.now();
    const raw = await chatJson(
      {
        protocol: model.protocol,
        baseUrl: model.baseUrl,
        modelId: model.modelId,
        apiKey: model.apiKey,
        system,
        user: attempt === 0 ? user : `${user}\n(再次提醒:只输出一个 JSON 对象,不要任何解释)`,
        timeoutSec: model.timeoutSec,
      },
      (u) => {
        lastUsage = u;
      },
    );
    const parsed = parse(raw);
    if (parsed.ok) {
      if (usageRole) {
        await recordAiUsage({
          role: usageRole,
          modelId: model.id,
          modelKey: model.modelId,
          tokensIn: lastUsage.tokensIn,
          tokensOut: lastUsage.tokensOut,
          durationMs: Date.now() - startedAt,
          status: model.source === "backup" ? "degraded" : "ok",
        });
      }
      return parsed.data;
    }
    lastParseError = parsed.error;
  }
  if (usageRole) {
    await recordAiUsage({
      role: usageRole,
      modelId: model.id,
      modelKey: model.modelId,
      tokensIn: lastUsage.tokensIn,
      tokensOut: lastUsage.tokensOut,
      status: "failed",
    });
  }
  throw new AiClientError("business", `LLM 输出无法解析:${lastParseError}`);
}
