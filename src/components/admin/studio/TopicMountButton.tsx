"use client";

/**
 * 素材添加钮(2026-10-20 详情页重构文案:挂载→添加,讲用户语言):
 * POST /api/topics/[id]/items,成功刷新;409(重复添加)等行内红字。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ApiEnvelope } from "@/lib/http/response";

export default function TopicMountButton({
  topicId,
  itemType,
  itemId,
}: {
  topicId: string;
  itemType: "telegram" | "post";
  itemId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function mount(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/topics/${topicId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemType, itemId }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (!res.ok || body.code !== 0) {
        setErr(body.message || `添加失败(${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setErr("网络异常,请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={() => void mount()}
        disabled={busy}
        className="rounded-sm border border-line px-2.5 py-1 text-xs text-text-2 hover:border-accent hover:text-text-1 disabled:opacity-50"
      >
        添加
      </button>
      {err && (
        <span className="max-w-48 text-right text-[11px] text-red" role="alert">
          {err}
        </span>
      )}
    </span>
  );
}
