"use client";

/**
 * 仓库行操作(M11 批②,镜像 BloggerRowOps):
 * 启停(调度)/ 立即同步 / 编辑 / 文章(配套文章关联)/ 上架下架(前台 display)/
 * 删除两步武装——调度启用中删除先提示停用;停用后 confirm 物理删。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import RepoDialog, { type RepoDialogData } from "./RepoDialog";
import PostsLinkDialog from "./PostsLinkDialog";
import type { ApiEnvelope } from "@/lib/http/response";

export default function RepoRowOps({
  repo,
}: {
  repo: RepoDialogData & { fullName: string; enabled: boolean; display: boolean };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggleEnabled(): Promise<void> {
    const next = !repo.enabled;
    if (!next && !confirm(`确认停用「${repo.fullName}」?停用后调度器不再同步该仓库。`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/github/repos/${repo.id}/status`, {
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

  async function toggleDisplay(): Promise<void> {
    const next = !repo.display;
    setBusy(true);
    try {
      const res = await fetch(`/api/github/repos/${repo.id}/status`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display: next }),
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

  async function syncNow(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/github/repos/${repo.id}/sync`, { method: "POST" });
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

  async function remove(): Promise<void> {
    if (repo.enabled) {
      alert("仓库调度启用中,先停用再删除(两步武装删除)。");
      return;
    }
    if (!confirm(`确认删除「${repo.fullName}」?进展动态与配套文章关联一并清除。`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/github/repos/${repo.id}`, { method: "DELETE" });
      const body = (await res.json()) as ApiEnvelope;
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
          repo.enabled ? "text-red hover:bg-red/10" : "text-accent hover:bg-accent-dim"
        }`}
      >
        {repo.enabled ? "停用" : "启用"}
      </button>
      {repo.enabled && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void syncNow()}
          className="cursor-pointer rounded-sm px-2 py-1 text-accent hover:bg-accent-dim disabled:opacity-50"
        >
          立即同步
        </button>
      )}
      <RepoDialog
        label="编辑"
        repo={repo}
        buttonClass="cursor-pointer rounded-sm px-2 py-1 text-text-2 hover:bg-panel-2 disabled:opacity-50"
      />
      <PostsLinkDialog repoId={repo.id} fullName={repo.fullName} />
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggleDisplay()}
        className="cursor-pointer rounded-sm px-2 py-1 text-text-2 hover:bg-panel-2 disabled:opacity-50"
        title="前台展示开关(下架不删数据)"
      >
        {repo.display ? "下架" : "上架"}
      </button>
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
