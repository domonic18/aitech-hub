/**
 * 连通性探针(M8 批⑥,arch/04 §4「测试连通性入口」):LLM openai/anthropic
 * 双协议 chat ping;ASR openai/minimax 双协议 1s 正弦波实调转写。
 * 结果只落 ProbeResult(持久化在 admin service),永不 throw;
 * detail 不含密钥(响应体可能回显鉴权错,截 200 字符且不主动拼凭据)。
 */
import { logger } from "../logger";
import {
  AI_PROTOCOL_ANTHROPIC,
  AI_PROTOCOL_OPENAI,
  ASR_PROTOCOL_MINIMAX,
  ASR_PROTOCOL_OPENAI,
} from "./constants";

export interface ProbeInput {
  protocol: string;
  baseUrl: string | null;
  modelId: string;
  apiKey: string | null;
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
      detail: `HTTP ${res.status}: ${body.slice(0, 200) || "(空响应)"}`,
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
