"use client";

/**
 * 发现治理台状态流转钮组(M25 批③):词库(active/dismissed/pending)与候选
 * (approved/rejected/pending)同形异参——当前态高亮禁点,点击直改(无确认步:
 * 三态互相可逆,误点可点回),成功后 router.refresh 拉新列表;message≠ok 的
 * 成功响应(如博主候选批准自动登记结果)以行内提示呈现。枚举与标签
 * 统一取自 lib/discovery/status(纯常量,客户端安全)。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  CANDIDATE_STATUSES,
  CANDIDATE_STATUS_LABELS,
  KEYWORD_STATUSES,
  KEYWORD_STATUS_LABELS,
} from "@/lib/discovery/status";
import type { ApiEnvelope } from "@/lib/http/response";

const CONFIG = {
  keywords: { statuses: KEYWORD_STATUSES, labels: KEYWORD_STATUS_LABELS },
  candidates: { statuses: CANDIDATE_STATUSES, labels: CANDIDATE_STATUS_LABELS },
} as const;

export default function StatusControl({
  endpoint,
  id,
  status,
  name,
}: {
  endpoint: keyof typeof CONFIG;
  id: string;
  status: string;
  /** 无障碍名前缀(完整名:`${name} 状态流转`) */
  name: string;
}) {
  const { statuses, labels } = CONFIG[endpoint] as {
    statuses: readonly string[];
    labels: Record<string, string>;
  };
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function put(next: string): Promise<void> {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/discovery/${endpoint}/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (!res.ok || body.code !== 0) {
        setErr(body.message || `保存失败(${res.status})`);
        return;
      }
      // 成功但附说明(如博主候选自动登记结果)以行内提示呈现;"ok" 静默
      setNotice(body.message && body.message !== "ok" ? body.message : null);
      router.refresh();
    } catch {
      setErr("网络异常,请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div role="group" aria-label={`${name} 状态流转`} className="flex items-center gap-1">
        {statuses.map((s) =>
          s === status ? (
            <span
              key={s}
              className="rounded-sm border border-accent bg-accent-dim px-1.5 py-0.5 text-xs font-semibold text-accent"
            >
              {labels[s]}
            </span>
          ) : (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => put(s)}
              className="rounded-sm border border-line px-1.5 py-0.5 text-xs text-text-2 hover:border-line-hover hover:text-text-1 disabled:opacity-50"
            >
              {labels[s]}
            </button>
          ),
        )}
      </div>
      {err && <span className="text-[11px] text-red">{err}</span>}
      {!err && notice && (
        <span className="max-w-64 text-right text-[11px] leading-snug text-text-3">{notice}</span>
      )}
    </div>
  );
}
