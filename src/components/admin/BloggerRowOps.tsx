"use client";

/**
 * 博主行操作(M8 批③:启停 + 立即采集 + 编辑 + 删除两步武装——
 * 启用中删除先 409 提示停用;停用后 confirm 物理删。
 * 批⑧:补「作品」(站内作品列表,blogger 筛选)与「回填」(30 天窗深扫),
 * 对齐原型 ops 序;容器 flex-wrap,窄列自然换行。
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import BloggerDialog, { type BloggerDialogData } from "./BloggerDialog";

export default function BloggerRowOps({
  blogger,
}: {
  blogger: BloggerDialogData & { enabled: boolean };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggleEnabled(): Promise<void> {
    const next = !blogger.enabled;
    if (!next && !confirm(`确认停用「${blogger.nickname}」?停用后调度器不再派发该博主。`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/bloggers/${blogger.id}/status`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const body = (await res.json()) as { code: number; message: string };
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
      const res = await fetch(`/api/bloggers/${blogger.id}/crawl`, { method: "POST" });
      const body = (await res.json()) as { code: number; message: string };
      if (body.code !== 0) {
        alert(`触发失败:${body.message}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function backfillNow(): Promise<void> {
    if (
      !confirm(
        `回填将向前深扫 30 天(至多 3 页)补采「${blogger.nickname}」作品,已入库条目自动去重。确认?`,
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/bloggers/${blogger.id}/backfill`, { method: "POST" });
      const body = (await res.json()) as { code: number; message: string };
      if (body.code !== 0) {
        alert(`触发失败:${body.message}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (blogger.enabled) {
      alert("博主启用中,先停用再删除(两步武装删除)。");
      return;
    }
    if (!confirm(`确认删除「${blogger.nickname}」?已入库视频不受影响(博主名冗余隔离)。`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/bloggers/${blogger.id}`, { method: "DELETE" });
      const body = (await res.json()) as { code: number; message: string };
      if (body.code !== 0) {
        alert(`删除失败:${body.message}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 text-xs">
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggleEnabled()}
        className={`cursor-pointer rounded-sm px-2 py-1 disabled:opacity-50 ${
          blogger.enabled ? "text-red hover:bg-red/10" : "text-accent hover:bg-accent-dim"
        }`}
      >
        {blogger.enabled ? "停用" : "启用"}
      </button>
      {blogger.enabled && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void crawlNow()}
          className="cursor-pointer rounded-sm px-2 py-1 text-accent hover:bg-accent-dim disabled:opacity-50"
        >
          立即采集
        </button>
      )}
      <BloggerDialog
        label="编辑"
        blogger={blogger}
        buttonClass="cursor-pointer rounded-sm px-2 py-1 text-text-2 hover:bg-panel-2 disabled:opacity-50"
      />
      <Link
        href={`/admin/telegram/?media=video&blogger=${encodeURIComponent(blogger.nickname)}`}
        className="rounded-sm px-2 py-1 text-text-2 hover:bg-panel-2"
        title="查看该博主已入库的视频作品"
      >
        作品
      </Link>
      {blogger.enabled && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void backfillNow()}
          className="cursor-pointer rounded-sm px-2 py-1 text-accent hover:bg-accent-dim disabled:opacity-50"
        >
          回填
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => void remove()}
        className="cursor-pointer rounded-sm px-2 py-1 text-red hover:bg-red/10 disabled:opacity-50"
      >
        删除
      </button>
    </div>
  );
}
