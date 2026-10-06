"use client";

/**
 * 列表行内操作(原型 admin-posts .ops):编辑为普通链接(M5-d 反馈:行点击 = 查看,
 * 编辑走显式按钮;旧文回填后同样可编辑,未回填行由编辑页保真只读兜底);
 * 发布/下架/删除走 /api/posts,成功后 router.refresh 重拉本页 RSC。
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PostDisplayState } from "@/lib/content/post-schema";

const OP_BTN =
  "cursor-pointer rounded-sm bg-transparent px-1.5 py-1 text-xs text-accent hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50";
const OP_DANGER = "text-red hover:bg-red/10 hover:text-red-hi";

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
        <Link href={`/admin/posts/${id}`} className={`${OP_BTN} inline-flex items-center`}>
          编辑
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
