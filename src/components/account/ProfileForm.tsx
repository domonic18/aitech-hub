"use client";

/**
 * 资料表单岛(M22 批②,需求3):昵称/简介;与 zod 契约共用边界
 * (ACCOUNT_LIMITS)。PATCH /api/account/profile,成功后整刷新同步
 * HeaderSession 头像下拉昵称(服务端取数面,无全局态可通知)。
 */
import { useState } from "react";

import { ACCOUNT_LIMITS } from "@/lib/users/account-schema";

const FIELD =
  "w-full rounded-sm border border-line bg-panel-2 px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-line-hover focus:outline-none";
const BTN =
  "cursor-pointer rounded-sm bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";

export default function ProfileForm({
  nickname,
  bio,
}: {
  nickname: string;
  bio: string;
}): React.ReactElement {
  const [name, setName] = useState(nickname);
  const [desc, setDesc] = useState(bio);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const changed = name !== nickname || desc !== bio;

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nickname: name.trim(), bio: desc.trim() }),
      });
      const body = (await res.json()) as { code: number; message?: string };
      if (body.code === 0) {
        setNote({ ok: true, text: "已保存" });
        setTimeout(() => window.location.reload(), 600); // 同步 Header 下拉昵称
        return;
      }
      setNote({ ok: false, text: body.message ?? `保存失败(${res.status})` });
    } catch {
      setNote({ ok: false, text: "网络错误,请重试" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-text-2" htmlFor="acc-nickname">
          昵称({ACCOUNT_LIMITS.nickname.min}-{ACCOUNT_LIMITS.nickname.max} 字)
        </label>
        <input
          id="acc-nickname"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={ACCOUNT_LIMITS.nickname.max}
          minLength={ACCOUNT_LIMITS.nickname.min}
          required
          className={FIELD}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-text-2" htmlFor="acc-bio">
          个人简介(选填,≤{ACCOUNT_LIMITS.bio.max} 字)
        </label>
        <textarea
          id="acc-bio"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          maxLength={ACCOUNT_LIMITS.bio.max}
          rows={3}
          placeholder="一句话介绍自己…"
          className={`${FIELD} resize-none`}
        />
      </div>
      {note && <p className={`text-xs ${note.ok ? "text-green" : "text-red"}`}>{note.text}</p>}
      <div>
        <button type="submit" disabled={busy || !changed} className={BTN}>
          {busy ? "保存中…" : "保存资料"}
        </button>
      </div>
    </form>
  );
}
