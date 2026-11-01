"use client";

/**
 * 公众号绑定卡(M66):认证订阅号无网页授权,绑定只能反着来——站内生成
 * 一次性 8 位码,用户到公众号对话框里直接发这串码即完成绑定。
 * 已绑定态展示脱敏 openid 与绑定时间,并提供解绑(历史会话/线索保留)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { UserBindingView } from "@/lib/channel/wechat-mp/bind";

const BTN =
  "cursor-pointer rounded-sm bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";
const BTN_GHOST =
  "cursor-pointer rounded-sm border border-line bg-panel-2 px-4 py-2 text-sm text-text-2 transition-colors hover:border-line-hover hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-60";

interface ApiBody {
  code: number;
  message?: string;
  data?: { code?: string; expiresInSeconds?: number };
}

export default function WechatMpBinding({
  initial,
}: {
  initial: UserBindingView;
}): React.ReactElement {
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function issue(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/account/wechat-mp/bind-code", { method: "POST" });
      const body = (await res.json().catch(() => null)) as ApiBody | null;
      if (!res.ok || body?.code !== 0 || !body.data?.code) {
        setError(body?.message ?? "绑定码生成失败,请稍后重试");
        return;
      }
      setCode(body.data.code);
    } finally {
      setBusy(false);
    }
  }

  async function unbind(): Promise<void> {
    if (!window.confirm("解绑后公众号将无法再识别你的站内账号,确定解绑?")) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/account/wechat-mp/bind", { method: "DELETE" });
      const body = (await res.json().catch(() => null)) as ApiBody | null;
      if (!res.ok || body?.code !== 0) {
        setError(body?.message ?? "解绑失败,请重试");
        return;
      }
      setCode(null);
      setNotice(body?.message ?? "已解绑");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (initial.bound) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-2">
          <span className="rounded-sm bg-green/12 px-1.5 py-0.5 font-medium text-green">
            已绑定
          </span>
          <span className="font-mono">{initial.openidMasked}</span>
          {initial.boundAt ? (
            <span className="text-text-3">
              绑定于 {new Date(initial.boundAt).toLocaleString("zh-CN", { hour12: false })}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-text-3">
          在公众号里提问时,答案会按你的站内账号偏好与历史来组织。
        </p>
        <div>
          <button type="button" onClick={unbind} disabled={busy} className={BTN_GHOST}>
            {busy ? "处理中…" : "解绑公众号"}
          </button>
        </div>
        {error && <p className="text-xs text-red">{error}</p>}
        {notice && !error && <p className="text-xs text-accent">{notice}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-3">
        生成一次性绑定码后,在公众号对话框里直接发送这串码即可完成绑定(10 分钟内有效, 码用后即失效)。
      </p>

      {code ? (
        <div className="rounded-sm border border-accent/30 bg-accent/5 px-4 py-3">
          <div className="text-[11px] text-text-3">在公众号里发送这串码</div>
          <div className="mt-1 select-all font-mono text-2xl font-bold tracking-[0.2em] text-accent">
            {code}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={issue} disabled={busy} className={BTN}>
          {busy ? "生成中…" : code ? "重新生成" : "生成绑定码"}
        </button>
      </div>

      {error && <p className="text-xs text-red">{error}</p>}
      {notice && !error && <p className="text-xs text-accent">{notice}</p>}
    </div>
  );
}
