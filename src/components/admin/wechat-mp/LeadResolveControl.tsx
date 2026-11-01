"use client";

/**
 * 转人工线索处置(M66 会话详情页):标记已处理 + 备注,成功后整页刷新
 * (RSC 重取 isManualPending / 线索列表)。同一会话多条线索时逐条处置,
 * 全清后待办角标解除;AI 回复全程不受影响。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

interface ApiBody {
  code: number;
  message?: string;
}

export default function LeadResolveControl({
  sessionId,
  leadId,
}: {
  sessionId: string;
  leadId: string;
}): React.ReactElement {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/wechat-mp/sessions/${sessionId}/handoff`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId, note: note.trim() || undefined }),
      });
      const body = (await res.json().catch(() => null)) as ApiBody | null;
      if (!res.ok || body?.code !== 0) {
        setError(body?.message ?? "处置失败,请重试");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={2000}
        placeholder="处置备注(可选)"
        className="min-w-[160px] flex-1 rounded-sm border border-line bg-panel-2 px-2 py-1 text-xs text-text-1 outline-none focus:border-accent"
      />
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="cursor-pointer rounded-sm bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "提交中…" : "标记已处理"}
      </button>
      {error && <span className="w-full text-[11px] text-red">{error}</span>}
    </div>
  );
}
