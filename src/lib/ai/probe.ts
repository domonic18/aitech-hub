/**
 * 连通性探针(M8 批⑥,arch/04 §4「测试连通性入口」;2026-10-16 反馈问题3
 * 用途感知):按模型绑定的用途分流到**真实业务端点**——文本类走 chat ping
 * (openai/anthropic 双协议),cover/illustrate 走 /images/generations 真实最小生成一张,
 * embedding 走 /embeddings 并校验向量维度(与 ai-invest 同思路:测试=真实冒烟,
 * 不再用 chat ping 一刀切误报可用模型)。ASR openai/minimax 双协议 1s 正弦波
 * 实调转写。结果只落 ProbeResult(持久化在 admin service),永不 throw;
 * detail 不含密钥(响应体可能回显鉴权错,截 200 字符且不主动拼凭据)。
 */
import { logger } from "../logger";
import {
  AI_PROTOCOL_ANTHROPIC,
  AI_PROTOCOL_OPENAI,
  AI_PURPOSE_COVER,
  AI_PURPOSE_EMBEDDING,
  AI_PURPOSE_ILLUSTRATE,
  AI_PURPOSE_INTERPRET,
  AI_PURPOSE_SEARCH,
  AI_PURPOSE_SUMMARIZE,
  AI_PURPOSE_WRITING,
  ASR_PROTOCOL_MINIMAX,
  ASR_PROTOCOL_OPENAI,
} from "./constants";
import { COVER_IMAGE_SIZE } from "./cover-prompt";
import { buildImagesBody, parseImagesResponse } from "./image-client";

export interface ProbeInput {
  protocol: string;
  baseUrl: string | null;
  modelId: string;
  apiKey: string | null;
  /** 模型绑定的用途(2026-10-16 反馈问题3):决定探针走哪些真实端点;空=仅 chat */
  purposes?: string[];
  /** 模型台账超时秒(生图探针随模型配置,与真实管线同源;缺省 60) */
  timeoutSec?: number;
  /** 模型台账扩展参数(生图探针浅合并进请求体,保留键后展开,与生图管线同形状) */
  extraParams?: Record<string, unknown>;
}

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  detail: string;
  /** true = 协议不支持测试(不落 last_test,不覆盖既有结果) */
  skipped?: boolean;
}

const PROBE_TIMEOUT_MS = 15_000;

interface RawProbe {
  ok: boolean;
  latencyMs: number;
  detail: string;
  /** ok 时的响应体(业务错包装协议二次判定用;失败路径截 200) */
  body: string;
}

/** 公共请求执行:超时/HTTP 归因/耗时;永不 throw */
async function runProbe(url: string, init: RequestInit): Promise<RawProbe> {
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const latencyMs = Date.now() - startedAt;
    const body = await res.text().catch(() => "");
    if (res.ok) return { ok: true, latencyMs, detail: `HTTP ${res.status} · ${latencyMs}ms`, body };
    return {
      ok: false,
      latencyMs,
      detail: `HTTP ${res.status}: ${humanizeErrorBody(body)}`,
      body: "",
    };
  } catch (e) {
    const latencyMs = Date.now() - startedAt;
    const detail =
      e instanceof Error && e.name === "TimeoutError"
        ? `超时 ${PROBE_TIMEOUT_MS / 1000}s`
        : String(e);
    return { ok: false, latencyMs, detail, body: "" };
  }
}

function authHeaders(apiKey: string | null): Record<string, string> {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

/**
 * 供应商 JSON 错误体提取人话 message(M39 验收反馈:403 异步未开通的原始体
 * 截 200 字符后 message 被代码/tid 噪音淹没):OpenAI 兼容惯例 error.message
 * (AiHubMix async_not_enabled 实测同形);非 JSON/缺字段回退原文截断。
 * 已实测形态,非凭空假设;提取不到就走兜底,不会误吞信息。
 */
function humanizeErrorBody(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: { message?: unknown } | string };
    const msg =
      typeof j.error === "string"
        ? j.error
        : typeof j.error?.message === "string"
          ? j.error.message
          : null;
    if (msg && msg.trim() !== "") return msg.slice(0, 200);
  } catch {
    // 非 JSON 体:走原文兜底
  }
  return text.slice(0, 200) || "(空响应)";
}

/**
 * 生成正弦波 WAV(1s/440Hz/振幅 0.3/16kHz/mono/16-bit PCM):
 * 44 字节 RIFF 头 + 32000 字节采样,内存即生成即用(参考实现同款防呆样例)。
 */
export function buildSineWav(seconds = 1, freq = 440, amplitude = 0.3, sampleRate = 16000): Buffer {
  const numSamples = seconds * sampleRate;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // fmt chunk 长度
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * freq * i) / sampleRate));
    buf.writeInt16LE(sample, 44 + i * 2);
  }
  return buf;
}

/** LLM chat ping(2xx 即通;max_tokens=1 最小成本) */
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

/** 生图探针超时下限/上限:生图本身比 chat 慢一个量级,15s 会误报超时(实测
 * 5~15s 常态);随模型台账 timeoutSec 走(与真实管线同源),收敛在 15~120s */
const IMAGE_PROBE_TIMEOUT_MIN_SEC = 15;
const IMAGE_PROBE_TIMEOUT_MAX_SEC = 120;

/** 生图探针:真实最小生成一张(计费一张,测试按钮低频可接受),
 * 2xx 且 data[0]/output[0] 含 b64_json/url/content_url 即通——请求形状与
 * image-client 全对齐(经 buildImagesBody 同源构造,extraParams 保留键恒覆盖、
 * 显式 null 剔除/尺寸 1344x768/双数组双键形态校验与管线同口径,M39 收 AiHubMix
 * output[]/content_url),探针比管线严或松都会造成「测试失败但实际可用」或反向误报 */
async function probeImages(input: ProbeInput, baseUrl: string): Promise<ProbeResult> {
  if (input.protocol !== AI_PROTOCOL_OPENAI) {
    return {
      ok: false,
      latencyMs: 0,
      detail: "生图协议不支持(需 OpenAI images/generations 兼容端点,与生图管线同门禁)",
    };
  }
  const timeoutSec = Math.min(
    Math.max(input.timeoutSec ?? 60, IMAGE_PROBE_TIMEOUT_MIN_SEC),
    IMAGE_PROBE_TIMEOUT_MAX_SEC,
  );
  const startedAt = Date.now();
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/images/generations`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(input.apiKey) },
      // 请求体与 image-client 同源构造器(保留键 null 剔除语义一致,同口径)
      body: JSON.stringify(
        buildImagesBody(
          {
            model: input.modelId,
            prompt: "连通性测试",
            n: 1,
            size: COVER_IMAGE_SIZE,
            response_format: "b64_json",
          },
          input.extraParams,
        ),
      ),
      signal: AbortSignal.timeout(timeoutSec * 1000),
    });
    const latencyMs = Date.now() - startedAt;
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return {
        ok: false,
        latencyMs,
        detail: `HTTP ${res.status}: ${humanizeErrorBody(text)}`,
      };
    }
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      return { ok: false, latencyMs, detail: "生图响应不是 JSON(契约漂移)" };
    }
    // 响应解析单源(E2 收口):OpenAI data[] / AiHubMix output[] 双形态与
    // generateImages 共用 parseImagesResponse,行级校验口径天然一致
    const parsed = parseImagesResponse(body);
    if (!parsed.hasRows || parsed.images.length === 0) {
      return {
        ok: false,
        latencyMs,
        detail: parsed.bizError
          ? `生图失败:${parsed.bizError.slice(0, 200)}`
          : parsed.hasRows
            ? "生图响应无 b64_json/url 图片数据(契约漂移)"
            : "生图响应缺 data/output 数组(契约漂移)",
      };
    }
    return { ok: true, latencyMs, detail: `生图连通 ${latencyMs}ms(计费 1 张)` };
  } catch (e) {
    const latencyMs = Date.now() - startedAt;
    const detail =
      e instanceof Error && e.name === "TimeoutError"
        ? `超时 ${timeoutSec}s(生图慢,可重试或在模型台账调大超时)`
        : String(e);
    return { ok: false, latencyMs, detail };
  }
}

/** 向量探针:与 embedding-client 同请求形状;2xx 且 data[0].embedding 非空即通,报维度 */
async function probeEmbedding(input: ProbeInput, baseUrl: string): Promise<ProbeResult> {
  const startedAt = Date.now();
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(input.apiKey) },
      body: JSON.stringify({ model: input.modelId, input: ["ping"] }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - startedAt;
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return {
        ok: false,
        latencyMs,
        detail: `HTTP ${res.status}: ${humanizeErrorBody(text)}`,
      };
    }
    let body: { data?: unknown };
    try {
      body = JSON.parse(text) as { data?: unknown };
    } catch {
      return { ok: false, latencyMs, detail: "embedding 响应不是 JSON(契约漂移)" };
    }
    const rows = body.data;
    const emb = Array.isArray(rows)
      ? (rows[0] as { embedding?: unknown } | undefined)?.embedding
      : undefined;
    if (!Array.isArray(emb) || emb.length === 0) {
      return { ok: false, latencyMs, detail: "响应缺少向量字段(契约漂移)" };
    }
    return { ok: true, latencyMs, detail: `向量连通 ${latencyMs}ms(${emb.length} 维)` };
  } catch (e) {
    const latencyMs = Date.now() - startedAt;
    const detail =
      e instanceof Error && e.name === "TimeoutError"
        ? `超时 ${PROBE_TIMEOUT_MS / 1000}s`
        : String(e);
    return { ok: false, latencyMs, detail };
  }
}

/** 用途→探针种类:文本类(interpret/summarize/search/writing)共享 chat;
 * cover/illustrate→images;embedding→embeddings;未绑用途回退 chat(M8 旧语义) */
function probeKinds(purposes: string[] | undefined): Array<"chat" | "images" | "embeddings"> {
  const has = (p: string): boolean => purposes?.includes(p) ?? false;
  const kinds: Array<"chat" | "images" | "embeddings"> = [];
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
  return kinds;
}

/** 用途感知模型探针(2026-10-16 反馈问题3):按绑定用途逐个打真实端点,
 * 全部通过才算 ok;detail 分种类汇总(chat 首选人话,失败带种类前缀可归因) */
export async function probeModel(input: ProbeInput): Promise<ProbeResult> {
  if (input.protocol !== AI_PROTOCOL_OPENAI && input.protocol !== AI_PROTOCOL_ANTHROPIC) {
    logger.info({ event: "ai_probe.skipped", kind: "model", protocol: input.protocol });
    return {
      ok: false,
      latencyMs: 0,
      detail: "该协议暂不支持连通性测试(仅 openai/anthropic)",
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
      kind === "chat"
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

/** ASR 转写探针:正弦波无语音,转写文本为空属成功(UI 注明防误报) */
export async function probeAsr(input: ProbeInput): Promise<ProbeResult> {
  if (input.protocol !== ASR_PROTOCOL_OPENAI && input.protocol !== ASR_PROTOCOL_MINIMAX) {
    logger.info({ event: "ai_probe.skipped", kind: "asr", protocol: input.protocol });
    return {
      ok: false,
      latencyMs: 0,
      detail: "该协议暂不支持连通性测试(仅 openai/minimax)",
      skipped: true,
    };
  }
  if (!input.baseUrl) return { ok: false, latencyMs: 0, detail: "Base URL 未配置" };
  const form = new FormData();
  const wav = buildSineWav();
  // 拷出独立 ArrayBuffer(Buffer 泛型含 SharedArrayBuffer,不入 BlobPart)
  const wavAb = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
  form.append("file", new Blob([wavAb], { type: "audio/wav" }), "probe.wav");
  form.append("model", input.modelId);
  const url =
    input.protocol === ASR_PROTOCOL_MINIMAX
      ? `${input.baseUrl}/v1/speech_to_text`
      : `${input.baseUrl}/audio/transcriptions`;
  const raw = await runProbe(url, {
    method: "POST",
    headers: authHeaders(input.apiKey),
    body: form,
  });
  if (!raw.ok) return { ok: false, latencyMs: raw.latencyMs, detail: raw.detail };
  if (input.protocol === ASR_PROTOCOL_MINIMAX) {
    // minimax 业务错包装在 2xx 里:base_resp.status_code != 0 即失败,读 status_msg
    try {
      const parsed = JSON.parse(raw.body) as {
        base_resp?: { status_code?: number; status_msg?: string };
      };
      const code = parsed.base_resp?.status_code;
      if (code !== undefined && code !== 0) {
        return {
          ok: false,
          latencyMs: raw.latencyMs,
          detail: `业务错误 ${code}: ${parsed.base_resp?.status_msg ?? "unknown"}`,
        };
      }
    } catch {
      // 响应非 JSON:保守按 HTTP 2xx 通过(正弦波样本场景防误报)
    }
  }
  return { ok: true, latencyMs: raw.latencyMs, detail: raw.detail };
}
