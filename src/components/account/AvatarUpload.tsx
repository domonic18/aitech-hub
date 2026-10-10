"use client";

/**
 * 头像上传岛(M22 批②,需求10):现图/默认图预览 + 选择新图即传。
 * jpg/png/webp ≤2MB(与 zod/服务端同界);成功整刷新同步 Header 头像。
 */
import { useRef, useState } from "react";

import Avatar from "@/components/site/Avatar";
import { AVATAR_MAX_BYTES, AVATAR_MIME_WHITELIST } from "@/lib/users/account-schema";

export default function AvatarUpload({
  nickname,
  avatarPath,
}: {
  nickname: string;
  avatarPath: string | null;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = ""; // 允许重选同一文件
    if (!file) return;
    if (!(AVATAR_MIME_WHITELIST as readonly string[]).includes(file.type)) {
      setNote({ ok: false, text: "仅支持 jpg/png/webp" });
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setNote({ ok: false, text: "头像不超过 2MB" });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/account/avatar", { method: "POST", body: form });
      const body = (await res.json()) as { code: number; message?: string };
      if (body.code === 0) {
        setNote({ ok: true, text: "头像已更新" });
        setTimeout(() => window.location.reload(), 600);
        return;
      }
      setNote({ ok: false, text: body.message ?? `上传失败(${res.status})` });
    } catch {
      setNote({ ok: false, text: "网络错误,请重试" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar nickname={nickname} avatarPath={avatarPath} size="lg" />
      <div>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="cursor-pointer rounded-sm border border-line bg-panel px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "上传中…" : "更换头像"}
        </button>
        <p className="mt-1.5 text-[11px] text-text-3">jpg/png/webp,≤2MB</p>
        {note && (
          <p className={`mt-1 text-xs ${note.ok ? "text-green" : "text-red"}`}>{note.text}</p>
        )}
      </div>
      <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={onPick} />
    </div>
  );
}
