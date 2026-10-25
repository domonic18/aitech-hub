/** ASR 转写探针(M47 批D 自 probe.ts 拆出):正弦波 WAV 实调转写 */
import { logger } from "../logger";
import { ASR_PROTOCOL_MINIMAX, ASR_PROTOCOL_OPENAI } from "./constants";
import { authHeaders, runProbe, type ProbeInput, type ProbeResult } from "./probe-shared";

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
