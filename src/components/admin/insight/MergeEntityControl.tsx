"use client";

/**
 * 实体人工归并(M60):把当前实体并入目标实体(目标可填规范键或任一别名)。
 * POST /api/insight/entities/merge 后刷新页面——目标实体承接别名/事件/子实体,
 * 当前路径命中已归并实体时服务端会跳到目标(canonical 链接)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ApiEnvelope } from "@/lib/http/response";

interface MergeOutcome {
  movedAliases: number;
  movedEvents: number;
  movedChildren: number;
  movedSnapshots: number;
}

export default function MergeEntityControl({ fromKey }: { fromKey: string }): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (target.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/insight/entities/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromKey, toKey: target.trim() }),
      });
      const body = (await res.json()) as ApiEnvelope<MergeOutcome | null>;
      if (body.code !== 0) {
        setError(body.message);
        return;
      }
      router.refresh();
    } catch {
      setError("请求失败,请重试");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer rounded-sm border border-line bg-panel px-2 py-0.5 text-[11px] text-text-3 hover:border-line-hover hover:text-text-1"
      >
        归并到…
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        placeholder="目标实体键或别名"
        aria-label="归并目标实体键"
        maxLength={120}
        className="w-44 rounded-sm border border-line bg-panel px-1.5 py-0.5 font-mono text-[11px] text-text-2"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className="cursor-pointer rounded-sm bg-panel-2 px-2 py-0.5 text-[11px] text-text-2 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "归并中…" : "确认归并"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        className="cursor-pointer text-[11px] text-text-3 hover:text-text-1"
      >
        取消
      </button>
      {error && <span className="text-[11px] text-red">{error}</span>}
    </span>
  );
}
