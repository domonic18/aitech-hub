/**
 * 连通性探针公共内核(M47 批D 自 probe.ts 切出,四探针拆分共用):
 * 入参/出参形状、请求执行(超时/HTTP 归因/耗时,永不 throw)、鉴权头、
 * 供应商错误体人话化。结果只落 ProbeResult(持久化在 admin service);
 * detail 不含密钥(响应体可能回显鉴权错,截 200 字符且不主动拼凭据)。
 */

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

export const PROBE_TIMEOUT_MS = 15_000;

export interface RawProbe {
  ok: boolean;
  latencyMs: number;
  detail: string;
  /** ok 时的响应体(业务错包装协议二次判定用;失败路径截 200) */
  body: string;
}

/** 公共请求执行:超时/HTTP 归因/耗时;永不 throw */
export async function runProbe(url: string, init: RequestInit): Promise<RawProbe> {
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

export function authHeaders(apiKey: string | null): Record<string, string> {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

/**
 * 供应商 JSON 错误体提取人话 message(M39 验收反馈:403 异步未开通的原始体
 * 截 200 字符后 message 被代码/tid 噪音淹没):OpenAI 兼容惯例 error.message
 * (AiHubMix async_not_enabled 实测同形);非 JSON/缺字段回退原文截断。
 * 已实测形态,非凭空假设;提取不到就走兜底,不会误吞信息。
 */
export function humanizeErrorBody(text: string): string {
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
