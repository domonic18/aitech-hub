"use client";

/**
 * PAT 吊销按钮岛(M5-c):原生 confirm → POST /api/pats/[id]/revoke →
 * 刷新服务端列表。吊销即时生效:持该令牌的客户端下一次请求即 401。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function PatRevokeButton({ id }: { id: string }): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const revoke = async (): Promise<void> => {
    if (!confirm(`确认吊销令牌 #${id}?使用它的客户端将立即 401。`)) return;
    setBusy(true);
    try {
      await fetch(`/api/pats/${id}/revoke`, { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void revoke()}
      className="rounded-sm border border-line px-2.5 py-1 text-xs text-red hover:bg-panel-2 disabled:opacity-50"
    >
      {busy ? "吊销中…" : "吊销"}
    </button>
  );
}
