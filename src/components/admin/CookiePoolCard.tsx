"use client";

/**
 * Cookie 池状态卡(M8 批③):每平台一行——jar 数/脱敏 ttwid 前缀/导入/清空。
 * Cookie 值只写不读:textarea 粘完整浏览器 Cookie,提交后即刻清空不回显。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { CookiePoolView } from "@/lib/telegram/social-platform-admin";

export default function CookiePoolCard({ pools }: { pools: CookiePoolView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cookie, setCookie] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const close = (): void => {
    setOpen(false);
    setError(null);
    setCookie("");
  };

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bloggers/cookies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: "douyin", cookie: cookie.trim() }),
      });
      const body = (await res.json()) as {
        code: number;
        message: string;
        data?: { jarCount: number };
      };
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      setNotice(`导入成功,当前池 ${body.data?.jarCount ?? "?"} 份 jar`);
      close();
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function clearPool(): Promise<void> {
    if (!confirm("确认清空抖音 Cookie 池?采集将跳过并提示「Cookie 池为空」。")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/bloggers/cookies?platform=douyin", { method: "DELETE" });
      const body = (await res.json()) as { code: number; message: string };
      if (body.code !== 0) {
        alert(`清空失败:${body.message}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const pool = pools.find((p) => p.platform === "douyin");
  const jarCount = pool?.jarCount ?? 0;

  return (
    <div className="rounded-md border border-line bg-panel px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[12.5px] text-text-2">
          <svg className="ic text-accent" aria-hidden="true">
            <use href="#i-key" />
          </svg>
          Cookie 池(抖音)
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="cursor-pointer rounded-sm border border-line px-2 py-1 text-[11px] text-text-2 hover:bg-panel-2"
          >
            导入
          </button>
          {jarCount > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void clearPool()}
              className="cursor-pointer rounded-sm px-2 py-1 text-[11px] text-red hover:bg-red/10 disabled:opacity-50"
            >
              清空
            </button>
          )}
        </div>
      </div>
      <div className="mt-2 font-mono text-[26px] font-bold leading-none tracking-[-0.01em] text-text-1">
        {jarCount}
        <span className="ml-1 text-sm font-medium text-text-3">份 jar</span>
      </div>
      <div
        className="mt-1.5 truncate font-mono text-[11px] text-text-3"
        title={pool?.masked.map((m) => m.ttwidPrefix).join(", ")}
      >
        {jarCount > 0
          ? pool!.masked.map((m) => `ttwid:${m.ttwidPrefix}…`).join("  ")
          : "池为空,采集将跳过(待导入)"}
      </div>
      <div
        className="mt-1.5 text-[11px] text-text-3"
        title="AUTH_SECRET 轮换会使已存密文失效,需重导 Cookie"
      >
        密钥来源:AUTH_SECRET 派生(AES-256-GCM)
      </div>
      {notice && <div className="mt-1.5 text-[11px] text-green">{notice}</div>}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-md border border-line bg-panel p-5 shadow-xl">
            <h3 className="text-sm font-semibold">导入抖音 Cookie</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-text-3">
              从已登录抖音的浏览器完整复制 Cookie 请求头(须含 ttwid,≥3 组键值对); 同 ttwid
              视为同身份,重复导入覆盖旧值。保存后立即加密,不再回显。
            </p>
            <textarea
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              rows={6}
              placeholder="ttwid=…; sessionid=…; msToken=…"
              className="mt-3 w-full rounded-sm border border-line bg-panel-2 px-2.5 py-2 font-mono text-xs text-text-1 outline-none focus:border-accent placeholder:text-text-3"
            />
            {error && <p className="mt-2 font-mono text-xs text-red">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
              >
                取消
              </button>
              <button
                type="button"
                disabled={busy || cookie.trim().length < 10}
                onClick={() => void submit()}
                className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {busy ? "导入中…" : "导入"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
