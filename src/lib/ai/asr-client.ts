/**
 * ASR 转写客户端(M9 批②,arch/02 §3.2 消费侧):openai/minimax 双协议,
 * 请求形状与探针 probeAsr 同源(同 URL 拼法/同鉴权/同业务错判定)。
 * 音频字节仅以请求体过境,本层不落盘不留存(临时文件即删在 processor)。
 * 错误 kind:unsupported(协议/配置)/http(网络+HTTP 状态)/business(2xx 业务错)/timeout。
 */
import { ASR_PROTOCOL_MINIMAX, ASR_PROTOCOL_OPENAI } from "./constants";
import { AiClientError } from "./errors";

export interface TranscribeInput {
  protocol: string;
  baseUrl: string | null;
  modelId: string;
  apiKey: string | null;
  /** 抽轨产物字节(mp3/wav;调用方持临时文件负责即删) */
  audio: Buffer;
  filename: string;
  /** 领域热词:openai 协议映射 whisper prompt 引导识别;minimax 无对应字段不传 */
  hotwords?: string[];
  timeoutSec: number;
}

function authHeaders(apiKey: string | null): Record<string, string> {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

/** Buffer → 独立 ArrayBuffer(泛型含 SharedArrayBuffer 不入 BlobPart,probe.ts 同坑) */
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export async function transcribeAudio(input: TranscribeInput): Promise<string> {
  if (input.protocol !== ASR_PROTOCOL_OPENAI && input.protocol !== ASR_PROTOCOL_MINIMAX) {
    throw new AiClientError("unsupported", `ASR 协议不支持(${input.protocol})`);
  }
  if (!input.baseUrl) throw new AiClientError("unsupported", "ASR Base URL 未配置");

  const form = new FormData();
  const mime = input.filename.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg";
  form.append("file", new Blob([toArrayBuffer(input.audio)], { type: mime }), input.filename);
  form.append("model", input.modelId);
  if (input.protocol === ASR_PROTOCOL_OPENAI && input.hotwords?.length) {
    form.append("prompt", input.hotwords.join(","));
  }
  const url =
    input.protocol === ASR_PROTOCOL_MINIMAX
      ? `${input.baseUrl}/v1/speech_to_text`
      : `${input.baseUrl}/audio/transcriptions`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: authHeaders(input.apiKey),
      body: form,
      signal: AbortSignal.timeout(input.timeoutSec * 1000),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new AiClientError("timeout", `ASR 超时 ${input.timeoutSec}s`);
    }
    throw new AiClientError("http", err instanceof Error ? err.message : String(err));
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = body === null ? "" : `: ${JSON.stringify(body).slice(0, 200)}`;
    throw new AiClientError("http", `HTTP ${res.status}${detail}`);
  }
  // minimax 业务错包装在 2xx 里:base_resp.status_code != 0 即失败(probe 同判定)
  if (input.protocol === ASR_PROTOCOL_MINIMAX) {
    const br = (body as { base_resp?: { status_code?: number; status_msg?: string } } | null)
      ?.base_resp;
    if (br?.status_code !== undefined && br.status_code !== 0) {
      throw new AiClientError(
        "business",
        `业务错误 ${br.status_code}: ${br.status_msg ?? "unknown"}`,
      );
    }
  }
  const text = (body as { text?: unknown } | null)?.text;
  if (typeof text !== "string") {
    throw new AiClientError("business", "2xx 响应缺 text 字段(契约漂移)");
  }
  return text;
}
