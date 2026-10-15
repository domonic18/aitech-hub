"use client";

/**
 * 同步批量动作请求助手(M31 验收反馈:六后台面批量治理共用):POST JSON →
 * apiEnvelope 解包。ok = HTTP 2xx 且业务 code=0,data 携 BatchOutcome 形状;
 * 非 2xx/业务非 0 → 人话 message(代理 HTML 错误页兜底)。
 */
import type { ApiEnvelope } from "@/lib/http/response";
import type { BatchOutcome } from "@/lib/http/batch";

export async function postBatch<T = BatchOutcome>(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; data?: T; message?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (res.ok && json !== null && json.code === 0) {
      return { ok: true, data: json.data };
    }
    return { ok: false, message: json?.message ?? `操作失败(${res.status})` };
  } catch {
    return { ok: false, message: "网络错误,请重试" };
  }
}

/** BatchOutcome → 人话结果串(updated + skipped 原因列表) */
export function outcomeText(prefix: string, out: BatchOutcome): string {
  const skipped =
    out.skipped.length > 0
      ? `;跳过:${out.skipped.map((s) => `${s.id}(${s.reason})`).join("、")}`
      : "";
  return `${prefix} ${out.updated} 项${skipped}`;
}
