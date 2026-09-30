"use client";

/**
 * 列表行内操作(原型 admin-posts .ops):编辑/查看为普通链接;
 * 发布/下架/删除走 /api/posts,成功后 router.refresh 重拉本页 RSC。
 * 旧文保真行(WP 迁移纯 HTML)只有 查看/下架/重新上架,无编辑无删除(降级注记)。
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PostDisplayState } from "@/lib/content/post-schema";

const OP_BTN =
  "cursor-pointer bg-transparent p-0 text-xs text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50";
const OP_DANGER = "text-red hover:text-red-hi";

export default function PostRowOps({
  id,
  state,
  legacy,
}: {
  id: string;
  state: PostDisplayState;
  legacy: boolean;
}): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(path: string, method: string, confirmText?: string): Promise<void> {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, { method });
      if (res.ok) {
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? `操作失败(${res.status})`);
    } catch {
      setError("网络错误,请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex items-center gap-2.5">
        <Link href={`/admin/posts/${id}`} className="text-xs text-accent hover:underline">
          {legacy ? "查看" : "编辑"}
        </Link>
        {state !== "published" && (
          <button
            type="button"
            disabled={busy}
            className={OP_BTN}
            onClick={() => act(`/api/posts/${id}/publish`, "POST")}
          >
            {state === "unpublished" ? "重新上架" : "发布"}
          </button>
        )}
        {state === "published" && (
          <button
            type="button"
            disabled={busy}
            className={OP_BTN}
            onClick={() => act(`/api/posts/${id}/unpublish`, "POST")}
          >
            下架
          </button>
        )}
        {!legacy && (
          <button
            type="button"
            disabled={busy}
            className={`${OP_BTN} ${OP_DANGER}`}
            onClick={() =>
              act(`/api/posts/${id}`, "DELETE", "确认删除该文章?删除后前台即刻不可见。")
            }
          >
            删除
          </button>
        )}
      </span>
      {error && <span className="text-[11px] text-red">{error}</span>}
    </span>
  );
}
