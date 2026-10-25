/** 向量探针(M47 批D 自 probe.ts 拆出):与 embedding-client 同请求形状 */
import {
  authHeaders,
  humanizeErrorBody,
  PROBE_TIMEOUT_MS,
  type ProbeInput,
  type ProbeResult,
} from "./probe-shared";

/** 向量探针:2xx 且 data[0].embedding 非空即通,报维度 */
export async function probeEmbedding(input: ProbeInput, baseUrl: string): Promise<ProbeResult> {
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
