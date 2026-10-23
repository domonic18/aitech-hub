"use client";

/**
 * 加词按钮(F25 页头「加入词库」/ 核心词行「加词库」共用):逐词 POST
 * /api/discovery/keywords(归一与幂等在服务端,409=已在库)。多词时串行
 * 提交,结束汇报 新入 N · 已在库 M;单词 409 直接显「已在词库」。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ApiEnvelope } from "@/lib/http/response";

export default function AddWordsButton({
  words,
  label,
}: {
  words: string[];
  label: string;
}): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function add(): Promise<void> {
    if (busy || words.length === 0) return;
    setBusy(true);
    setNote(null);
    let created = 0;
    let exists = 0;
    let failed = 0;
    try {
      for (const word of words) {
        const res = await fetch("/api/discovery/keywords", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ word }),
        });
        const body = (await res.json()) as ApiEnvelope<unknown>;
        if (body.code === 0) created += 1;
        else if (res.status === 409) exists += 1;
        else failed += 1;
      }
      const parts: string[] = [];
      if (created > 0) parts.push(`新入 ${created}`);
      if (exists > 0) parts.push(`已在库 ${exists}`);
      if (failed > 0) parts.push(`失败 ${failed}`);
      setNote(parts.join(" · ") || "无变化");
      if (created > 0) router.refresh();
    } catch {
      setNote("网络异常,请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy || words.length === 0}
        title={`把 ${words.length} 个核心词加入种子词库(已在库自动跳过)`}
        onClick={() => void add()}
        className="cursor-pointer rounded-sm bg-accent-dim px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "入库中…" : label}
      </button>
      {note !== null && <span className="text-[11px] text-text-3">{note}</span>}
    </span>
  );
}
