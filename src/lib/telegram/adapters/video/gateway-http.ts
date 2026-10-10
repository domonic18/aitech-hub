/**
 * 采集网关 HTTP 客户端(M24 批②自 douyin.ts 平移共享):POST + Zod 校验 +
 * 异常翻译,各平台适配器(douyin/bilibili)共用,平台差异只在请求 payload。
 */
import { z } from "zod";

import { env } from "../../../env";

import { gatewayErrorSchema } from "./gateway-contract";
import { GatewayUnavailableError, GatewayUpstreamError } from "./index";

export const TIMEOUT_MS = 60_000; // 网关侧含限速重试序列(1+2+5s),放宽到分钟级

/** 错误包络 detail 展平(pydantic 422 的 detail 是数组) */
export function formatDetail(detail: string | unknown[] | undefined): string {
  if (detail === undefined) return "";
  return typeof detail === "string" ? detail : JSON.stringify(detail);
}

/**
 * POST + Zod 校验 + 异常翻译。错误分流按状态码:
 * 503(浏览器槽位未就绪)与网络层故障 → Unavailable(编排层顺延不计失败);
 * 其余非 2xx(404 AccountInvalid/422 校验/502 适配层)→ Upstream(计入连续失败);
 * 2xx 但响应不合契约 → Upstream ContractDrift(漂移必须响,不许静默)。
 */
export async function gatewayPost<S extends z.ZodType>(
  path: string,
  payload: unknown,
  schema: S,
): Promise<z.output<S>> {
  let res: Response;
  try {
    res = await fetch(`${env.DOUYIN_GATEWAY_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new GatewayUnavailableError(err instanceof Error ? err.message : String(err));
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const errBody = gatewayErrorSchema.safeParse(body);
    const detail = errBody.success ? formatDetail(errBody.data.detail) : "";
    if (res.status === 503) {
      throw new GatewayUnavailableError(detail || "HTTP 503");
    }
    throw new GatewayUpstreamError(
      errBody.success && errBody.data.error ? errBody.data.error : `HTTP ${res.status}`,
      detail,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new GatewayUpstreamError("ContractDrift", parsed.error.message);
  }
  return parsed.data;
}
