"use client";

/**
 * F24 候选词卡行内终审动作:采纳(active)/合并(merged+mergedIntoId=相似词,
 * 板定零选择 UI——仅相似提示出现时出钮)/拒绝(dismissed)。直发 PUT
 * /api/discovery/keywords/[id],成功 router.refresh 拉新卡流;busy 互斥。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ApiEnvelope } from "@/lib/http/response";

export default function CandidateWordActions({
  id,
  word,
  similar,
}: {
  id: string;
  word: string;
  /** 卡面相似提示(W0 现算);无则不渲染合并钮 */
  similar: { id: string; word: string; pct: number } | null;
}): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function act(status: "active" | "dismissed" | "merged"): Promise<void> {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/discovery/keywords/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          ...(status === "merged" && similar !== null ? { mergedIntoId: similar.id } : {}),
        }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (!res.ok || body.code !== 0) {
        setErr(body.message || `操作失败(${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setErr("网络异常,请重试");
    } finally {
      setBusy(false);
    }
  }

  const btn =
    "cursor-pointer rounded-sm px-2 py-0.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      {err !== null && <span className="text-[11px] text-red">{err}</span>}
      <button
        type="button"
        disabled={busy}
        title={`采纳「${word}」:入种子词库生效,参与发现轮`}
        onClick={() => void act("active")}
        className={`${btn} bg-green/12 font-medium text-green hover:bg-green/20`}
      >
        采纳
      </button>
      {similar !== null && (
        <button
          type="button"
          disabled={busy}
          title={`合并进「${similar.word}」:本词记为别名,命中统计随目标词`}
          onClick={() => void act("merged")}
          className={`${btn} bg-accent-dim font-medium text-accent hover:bg-accent/20`}
        >
          合并
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        title={`拒绝「${word}」:不再产出(已存在的联想回灌也不复活)`}
        onClick={() => void act("dismissed")}
        className={`${btn} bg-panel-2 text-text-2 hover:text-text-1`}
      >
        拒绝
      </button>
    </span>
  );
}
