"use client";

/**
 * 人工开通/恢复卡(M21 批⑤,提案 §8):admin 输入账号(手机号或 wp_user_id)
 * + 文章 slug,POST /api/pay/admin/grant(写侧唯一入口 grantPurchase,
 * orderId=null)。manual=付费开通;admin_restore=退款撤销后恢复。
 */
import { useState } from "react";

export default function AdminManualGrantCard(): React.ReactElement {
  const [account, setAccount] = useState("");
  const [postSlug, setPostSlug] = useState("");
  const [action, setAction] = useState<"manual" | "admin_restore">("manual");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setHint(null);
    try {
      const r = await fetch("/api/pay/admin/grant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account, postSlug, action }),
      });
      const b = (await r.json()) as { code: number; message?: string; data?: { message?: string } };
      if (r.ok && b.code === 0) {
        setHint({ ok: true, text: b.data?.message ?? "已开通" });
        setAccount("");
        setPostSlug("");
      } else {
        setHint({ ok: false, text: b.message ?? `失败(${r.status})` });
      }
    } catch {
      setHint({ ok: false, text: "网络错误,请重试" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-line bg-panel p-4">
      <h3 className="text-sm font-semibold">人工开通 / 恢复</h3>
      <p className="mt-0.5 text-xs text-text-3">
        用户侧查无购买记录但已收款时人工补权;操作只进审计日志。
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          placeholder="手机号或 wp_user_id"
          className="w-48 rounded-sm border border-line bg-background px-3 py-1.5 text-[13px] outline-none focus:border-accent"
        />
        <input
          value={postSlug}
          onChange={(e) => setPostSlug(e.target.value)}
          placeholder="文章 slug"
          className="w-64 rounded-sm border border-line bg-background px-3 py-1.5 text-[13px] outline-none focus:border-accent"
        />
        <select
          value={action}
          onChange={(e) =>
            setAction(e.target.value === "admin_restore" ? "admin_restore" : "manual")
          }
          className="rounded-sm border border-line bg-background px-2 py-1.5 text-[13px] outline-none focus:border-accent"
        >
          <option value="manual">开通</option>
          <option value="admin_restore">恢复(退款撤销后)</option>
        </select>
        <button
          type="button"
          disabled={busy || account.trim() === "" || postSlug.trim() === ""}
          onClick={() => void submit()}
          className="rounded-sm bg-accent px-4 py-1.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "提交中…" : "提交"}
        </button>
        {hint && (
          <span className={`text-xs ${hint.ok ? "text-green" : "text-red"}`}>{hint.text}</span>
        )}
      </div>
    </div>
  );
}
