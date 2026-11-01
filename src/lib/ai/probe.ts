/**
 * 连通性探针编排(M8 批⑥,arch/04 §4「测试连通性入口」;2026-10-16 反馈问题3
 * 用途感知):按模型绑定的用途分流到**真实业务端点**——文本类走 chat ping
 * (openai/anthropic 双协议),cover/illustrate 走 /images/generations 真实最小生成一张,
 * embedding 走 /embeddings 并校验向量维度(与 ai-invest 同思路:测试=真实冒烟,
 * 不再用 chat ping 一刀切误报可用模型)。ASR openai/minimax 双协议 1s 正弦波
 * 实调转写。四探针与公共内核(M47 批D 拆出,拆文件守 350 行线)住各自模块:
 * ./probe-llm / ./probe-image / ./probe-embedding / ./probe-asr / ./probe-shared,
 * 此处留兼容出口,既有调用方(models/asr 测试路由与单测)不受影响。
 */
import { logger } from "../logger";
import {
  AI_PROTOCOL_ANTHROPIC,
  AI_PROTOCOL_OPENAI,
  AI_PURPOSE_COVER,
  AI_PURPOSE_EMBEDDING,
  AI_PURPOSE_ILLUSTRATE,
  AI_PROTOCOL_SYSTEMONE,
  AI_PURPOSE_INSIGHT_JUDGE,
  AI_PURPOSE_INTERPRET,
  AI_PURPOSE_SEARCH,
  AI_PURPOSE_SUMMARIZE,
  AI_PURPOSE_WRITING,
} from "./constants";

// ── 兼容出口:四探针与内核形状的实现住各自模块,既有调用方仍从 probe 取 ──
export { probeLlm } from "./probe-llm";
export { probeImages } from "./probe-image";
export { probeEmbedding } from "./probe-embedding";
export { probeAsr, buildSineWav } from "./probe-asr";
export type { ProbeInput, ProbeResult } from "./probe-shared";

import { probeEmbedding } from "./probe-embedding";
import { probeImages } from "./probe-image";
import { probeLlm } from "./probe-llm";
import type { ProbeInput, ProbeResult } from "./probe-shared";

/** 用途→探针种类:文本类(interpret/summarize/search/writing)共享 chat;
 * cover/illustrate→images;embedding→embeddings;未绑用途回退 chat(M8 旧语义) */
function probeKinds(
  purposes: string[] | undefined,
): Array<"chat" | "images" | "embeddings" | "decisions"> {
  const has = (p: string): boolean => purposes?.includes(p) ?? false;
  const kinds: Array<"chat" | "images" | "embeddings" | "decisions"> = [];
  if (
    !purposes ||
    purposes.length === 0 ||
    has(AI_PURPOSE_INTERPRET) ||
    has(AI_PURPOSE_SUMMARIZE) ||
    has(AI_PURPOSE_SEARCH) ||
    has(AI_PURPOSE_WRITING)
  ) {
    kinds.push("chat");
  }
  if (has(AI_PURPOSE_COVER) || has(AI_PURPOSE_ILLUSTRATE)) kinds.push("images");
  if (has(AI_PURPOSE_EMBEDDING)) kinds.push("embeddings");
  if (has(AI_PURPOSE_INSIGHT_JUDGE)) kinds.push("decisions");
  return kinds;
}

/** 用途感知模型探针(2026-10-16 反馈问题3):按绑定用途逐个打真实端点,
 * 全部通过才算 ok;detail 分种类汇总(chat 首选人话,失败带种类前缀可归因) */
export async function probeModel(input: ProbeInput): Promise<ProbeResult> {
  if (
    input.protocol !== AI_PROTOCOL_OPENAI &&
    input.protocol !== AI_PROTOCOL_ANTHROPIC &&
    input.protocol !== AI_PROTOCOL_SYSTEMONE
  ) {
    logger.info({ event: "ai_probe.skipped", kind: "model", protocol: input.protocol });
    return {
      ok: false,
      latencyMs: 0,
      detail: "该协议暂不支持连通性测试(仅 openai/anthropic/systemone)",
      skipped: true,
    };
  }
  if (!input.baseUrl) return { ok: false, latencyMs: 0, detail: "Base URL 未配置" };
  const baseUrl = input.baseUrl;
  const oks: string[] = [];
  const fails: string[] = [];
  let latencyMs = 0;
  for (const kind of probeKinds(input.purposes)) {
    const r =
      kind === "chat" || kind === "decisions"
        ? await probeLlm(input)
        : kind === "images"
          ? await probeImages(input, baseUrl)
          : await probeEmbedding(input, baseUrl);
    latencyMs = Math.max(latencyMs, r.latencyMs);
    (r.ok ? oks : fails).push(kind === "chat" ? r.detail : `${kind} ${r.detail}`);
  }
  return {
    ok: fails.length === 0,
    latencyMs,
    detail: fails.length > 0 ? fails.join(" ; ") : oks.join(" · "),
  };
}
