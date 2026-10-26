/**
 * 贴图 admin 客户端 API 壳(M41):fetch + ApiEnvelope 解包,错误不抛出、
 * 以信封返回(同 IllustrationStudio callApi 口径,防各组件手写漂移)。
 */
import type { ApiEnvelope } from "@/lib/http/response";

export async function callPinApi<T>(url: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  return body ?? { code: 500, message: `响应解析失败(HTTP ${res.status})`, data: null as T };
}

export const JSON_HEADERS = { "Content-Type": "application/json" };
