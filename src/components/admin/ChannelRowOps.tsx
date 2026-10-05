"use client";

/**
 * 渠道行操作(M7 批④:立即采集 + 编辑;2026-10-06 验收反馈问题3 加「调试」,
 * 对齐原型 ops;启停改由表格「启用」列 StatusSwitch 承担,此处不再重复)。
 * 采集入队即返回;结果看台账刷新(手动触发不等待网络完成)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import ChannelDialog, { type ChannelDialogData } from "./ChannelDialog";
import type { ApiEnvelope } from "@/lib/http/response";
import type { ChannelDebugResult } from "@/lib/telegram/channels-admin";

export default function ChannelRowOps({ channel }: { channel: ChannelDialogData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

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

  /** 调试(原型:拉最新 3 条 + 耗时):实时返回,alert 面板直读,不入库不动健康度 */
  async function debugNow(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/channels/${channel.id}/debug`, { method: "POST" });
      const body = (await res.json()) as ApiEnvelope<ChannelDebugResult>;
      if (body.code !== 0 || !body.data) {
        alert(`调试失败:${body.message || `HTTP ${res.status}`}`);
        return;
      }
      const { ok, elapsedMs, items, error } = body.data;
      const lines = items.map((i, idx) => `${idx + 1}. ${i.title}`);
      alert(
        [
          `「${channel.name}」调试${ok ? "成功" : "失败"} · 耗时 ${elapsedMs}ms`,
          ...(ok ? lines : []),
          ...(error ? [`错误:${error}`] : []),
        ].join("\n"),
      );
    } catch {
      alert("网络错误,请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1.5 text-xs">
      <button
        type="button"
        disabled={busy}
        onClick={() => void debugNow()}
        className="cursor-pointer rounded-sm px-2 py-1 text-text-2 hover:bg-panel-2 disabled:opacity-50"
      >
        调试
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
