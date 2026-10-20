"use client";

/**
 * 专题新建(M26 批③治理台):标题必填 + 定位可选,POST /api/topics 成功后
 * 直跳详情页。401/400 行内红字。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ApiEnvelope } from "@/lib/http/response";
import { DEFAULT_TOPIC_POSITIONING } from "@/lib/topics/constants";

export default function TopicCreateForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  // 预置推荐体角度底稿(1276 验收反馈:不要每次现填;用户可清空/改写)
  const [positioning, setPositioning] = useState(DEFAULT_TOPIC_POSITIONING);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (!title.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/topics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          ...(positioning.trim() ? { positioning: positioning.trim() } : {}),
        }),
      });
      const body = (await res.json()) as ApiEnvelope<{ id: string }>;
      if (!res.ok || body.code !== 0) {
        setErr(body.message || `创建失败(${res.status})`);
        return;
      }
      router.push(`/admin/topics/${body.data.id}`);
    } catch {
      setErr("网络异常,请重试");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90"
      >
        新建专题
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-line bg-panel p-3">
      <input
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="专题标题(必填,≤200 字符)…"
        className="w-80 rounded-sm border border-line bg-panel px-2.5 py-1.5 text-[13px] outline-none focus:border-accent placeholder:text-text-3"
      />
      <textarea
        value={positioning}
        maxLength={1000}
        onChange={(e) => setPositioning(e.target.value)}
        placeholder="写作要求(可选:选材与口吻指引,生成初稿时生效,≤1000 字符)…"
        rows={2}
        className="w-80 rounded-sm border border-line bg-panel px-2.5 py-1.5 text-[13px] outline-none focus:border-accent placeholder:text-text-3"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || title.trim() === ""}
          className="rounded-sm bg-accent px-3 py-1 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
        >
          创建
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setErr(null);
          }}
          className="rounded-sm border border-line px-3 py-1 text-xs text-text-2 hover:text-text-1"
        >
          取消
        </button>
        {err && <span className="text-[11px] text-red">{err}</span>}
      </div>
    </div>
  );
}
