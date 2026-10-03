"use client";

/**
 * 用户行内状态切换(M5-c):禁用带确认(连带吊销 PAT 提示),启用直接执行;
 * 成功 router.refresh 重拉本页(RSC 列表)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function UserStatusButton({
  id,
  nickname,
  status,
}: {
  id: string;
  nickname: string | null;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const disabling = status !== "disabled";

  async function toggle() {
    const label = nickname ?? `uid ${id}`;
    if (disabling && !confirm(`确认禁用 ${label}?其全部 PAT 将立即失效。`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${id}/status`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: disabling ? "disabled" : "active" }),
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

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`cursor-pointer rounded-sm px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${
        disabling ? "text-red hover:bg-red/10" : "text-accent hover:bg-accent-dim"
      }`}
    >
      {disabling ? "禁用" : "启用"}
    </button>
  );
}
