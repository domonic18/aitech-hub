"use client";

/**
 * PAT 创建岛(M5-c):名称表单 → POST /api/pats → 明文令牌一次性展示
 * (mono + 复制 + 「关闭后不可再查看」警示);关闭即焚,仅列表留哈希投影。
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export default function PatCreateDialog(): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const reset = (): void => {
    setOpen(false);
    setName("");
    setToken(null);
    setError(null);
    setCopied(false);
  };

  const create = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = (await res.json()) as {
        code: number;
        message: string;
        data?: { token: string };
      };
      if (!res.ok || body.code !== 0 || !body.data) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      setToken(body.data.token);
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (): Promise<void> => {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setTimeout(() => nameRef.current?.focus(), 0);
        }}
        className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
      >
        新建令牌
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-md border border-line bg-panel p-5 shadow-xl">
            {token === null ? (
              <>
                <h3 className="text-sm font-semibold">新建 PAT 令牌</h3>
                <p className="mt-1 text-xs text-text-3">
                  令牌等同于管理员凭证,仅创建时完整展示一次。备注用于识别来源(如
                  claude-code-laptop)。
                </p>
                <input
                  ref={nameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="令牌备注(必填,≤100 字)"
                  maxLength={100}
                  className="mt-3 w-full rounded-sm border border-line bg-panel-2 px-2.5 py-2 text-sm outline-none focus:border-accent"
                />
                {error && <p className="mt-2 font-mono text-xs text-red">{error}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={reset}
                    className="rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={busy || name.trim().length === 0}
                    onClick={() => void create()}
                    className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                  >
                    {busy ? "创建中…" : "创建"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold">令牌已创建</h3>
                <p className="mt-1 text-xs text-red">请立即复制保存,关闭后不可再查看。</p>
                <div className="mt-3 rounded-sm border border-line bg-panel-2 p-2.5 font-mono text-xs break-all text-text-1">
                  {token}
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => void copy()}
                    className="rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
                  >
                    {copied ? "已复制" : "复制"}
                  </button>
                  <button
                    type="button"
                    onClick={reset}
                    className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
                  >
                    我已保存,关闭
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
