"use client";

/**
 * 渠道行操作(M7 批④):启停 + 立即采集 + 编辑(内嵌 ChannelDialog)。
 * 采集入队即返回;结果看台账刷新(手动触发不等待网络完成)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import ChannelDialog, { type ChannelDialogData } from "./ChannelDialog";
import type { ApiEnvelope } from "@/lib/http/response";

export default function ChannelRowOps({ channel }: { channel: ChannelDialogData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggleEnabled(): Promise<void> {
    const next = !channel.enabled;
    if (!next && !confirm(`确认停用「${channel.name}」?停用后调度器不再派发采集任务。`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/channels/${channel.id}/status`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        alert(`操作失败:${body.message}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function crawlNow(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/channels/${channel.id}/crawl`, { method: "POST" });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        alert(`触发失败:${body.message}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1.5 text-xs">
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggleEnabled()}
        className={`cursor-pointer rounded-sm px-2 py-1 disabled:opacity-50 ${
          channel.enabled ? "text-red hover:bg-red/10" : "text-accent hover:bg-accent-dim"
        }`}
      >
        {channel.enabled ? "停用" : "启用"}
      </button>
      {channel.enabled && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void crawlNow()}
          className="cursor-pointer rounded-sm px-2 py-1 text-accent hover:bg-accent-dim disabled:opacity-50"
        >
          立即采集
        </button>
      )}
      <ChannelDialog
        label="编辑"
        channel={channel}
        buttonClass="cursor-pointer rounded-sm px-2 py-1 text-text-2 hover:bg-panel-2 disabled:opacity-50"
      />
    </div>
  );
}
