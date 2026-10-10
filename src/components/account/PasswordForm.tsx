"use client";

/**
 * 密码修改岛(M22 批②,需求3):旧密码必验;新密码边界走服务端
 * validatePassword(错误回显),前端只做非空/一致性预检。bcrypt 12 同注册。
 */
import { useState } from "react";

const FIELD =
  "w-full rounded-sm border border-line bg-panel-2 px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-line-hover focus:outline-none";
const BTN =
  "cursor-pointer rounded-sm bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";

export default function PasswordForm(): React.ReactElement {
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (newPwd !== confirm) {
      setNote({ ok: false, text: "两次输入的新密码不一致" });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
      });
      const body = (await res.json()) as { code: number; message?: string };
      if (body.code === 0) {
        setNote({ ok: true, text: "密码已更新" });
        setOldPwd("");
        setNewPwd("");
        setConfirm("");
        return;
      }
      setNote({ ok: false, text: body.message ?? `修改失败(${res.status})` });
    } catch {
      setNote({ ok: false, text: "网络错误,请重试" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-text-2" htmlFor="acc-old-pwd">
          当前密码
        </label>
        <input
          id="acc-old-pwd"
          type="password"
          value={oldPwd}
          onChange={(e) => setOldPwd(e.target.value)}
          autoComplete="current-password"
          required
          className={FIELD}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-2" htmlFor="acc-new-pwd">
            新密码(≥8 位)
          </label>
          <input
            id="acc-new-pwd"
            type="password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            autoComplete="new-password"
            required
            className={FIELD}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-2" htmlFor="acc-confirm-pwd">
            确认新密码
          </label>
          <input
            id="acc-confirm-pwd"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            className={FIELD}
          />
        </div>
      </div>
      {note && <p className={`text-xs ${note.ok ? "text-green" : "text-red"}`}>{note.text}</p>}
      <div>
        <button type="submit" disabled={busy} className={BTN}>
          {busy ? "提交中…" : "修改密码"}
        </button>
      </div>
    </form>
  );
}
