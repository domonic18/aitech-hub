"use client";

/**
 * 词库人工加词(M25 批③):输入词回车或点「添加」→ POST
 * /api/discovery/keywords;新建(origin=manual)直接生效并刷新列表;
 * 409=已存在(带当前状态提示,不算故障);其余错误行内红字。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import { WORD_MAX_LEN } from "@/lib/discovery/status";
import type { ApiEnvelope } from "@/lib/http/response";

export default function KeywordAddForm() {
  const router = useRouter();
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function submit(): Promise<void> {
    const w = word.trim();
    if (!w || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/discovery/keywords", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ word: w }),
      });
      const body = (await res.json()) as ApiEnvelope<{ word: string }>;
      if (res.status === 409) {
        setMsg({ tone: "err", text: body.message });
        return;
      }
      if (!res.ok || body.code !== 0) {
        setMsg({ tone: "err", text: body.message || `添加失败(${res.status})` });
        return;
      }
      setWord("");
      setMsg({ tone: "ok", text: `已添加并生效:${body.data.word}` });
      router.refresh();
    } catch {
      setMsg({ tone: "err", text: "网络异常,请重试" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-1 sm:w-auto">
      <div className="flex w-full items-center gap-2 rounded-sm border border-line bg-panel px-2.5 py-1.5 focus-within:border-accent sm:w-auto">
        <input
          value={word}
          maxLength={WORD_MAX_LEN}
          onChange={(e) => setWord(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder={`人工添加热词(≤${WORD_MAX_LEN} 字符,自动转小写,添加即生效)…`}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-3 sm:w-64 sm:flex-none"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || word.trim() === ""}
          className="shrink-0 rounded-sm bg-accent px-3 py-1 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
        >
          添加
        </button>
      </div>
      {msg && (
        <span className={`text-[11px] ${msg.tone === "ok" ? "text-green" : "text-red"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
