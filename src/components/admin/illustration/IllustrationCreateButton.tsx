"use client";

/**
 * 工坊「新建配图」直出生成(M41 批④):prompt/宽高比/张数 → 入队
 * illustration-studio 队列(attempts=1 计费不重试),出图即登记根版本,
 * 列表刷新可见。宽高比缺省 3:4(贴图场景竖版;工坊自由出图可改横版)。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ApiEnvelope } from "@/lib/http/response";
import DialogShell, { DialogActions } from "@/components/admin/DialogShell";

const ASPECTS = [
  { key: "3:4", label: "3:4 · 864×1152" },
  { key: "1:1", label: "1:1 · 1024" },
  { key: "16:9", label: "16:9 · 1344×768" },
] as const;

const COUNTS = [1, 2, 3] as const;

export default function IllustrationCreateButton(): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<string>("3:4");
  const [count, setCount] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enqueued, setEnqueued] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/illustration/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), aspect, count }),
      });
      const body = (await res.json().catch(() => null)) as ApiEnvelope<unknown> | null;
      if (!body || body.code !== 0) {
        setError(body?.message ?? `入队失败(HTTP ${res.status})`);
        return;
      }
      setEnqueued(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络异常");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setEnqueued(false);
    setError(null);
    setPrompt("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
      >
        <svg className="ic" aria-hidden="true">
          <use href="#i-robot" />
        </svg>
        新建配图
      </button>
      {open && (
        <DialogShell title="新建配图(文生图直出)" scroll>
          {enqueued ? (
            <div className="flex flex-col gap-3 py-2">
              <p className="text-[13px] text-text-2">
                已入队出图(约 15~60s,不自动重试)。完成后自动登记工坊根版本,刷新列表即可见。
              </p>
              <DialogActions>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    router.refresh();
                  }}
                  className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
                >
                  刷新列表
                </button>
              </DialogActions>
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              <div>
                <label className="text-xs text-text-2" htmlFor="illu-gen-prompt">
                  出图提示词
                </label>
                <textarea
                  id="illu-gen-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  placeholder="例:一图看懂 MCP 三角色架构,扁平插画,深色底,中文标注…"
                  className="mt-1 w-full rounded-sm border border-line bg-panel-2 px-2.5 py-2 text-[13px] text-text-1 outline-none focus:border-accent"
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-2">尺寸</span>
                  <div className="flex overflow-hidden rounded-sm border border-line">
                    {ASPECTS.map((a) => (
                      <button
                        key={a.key}
                        type="button"
                        onClick={() => setAspect(a.key)}
                        className={`cursor-pointer px-2.5 py-1 text-[11px] ${
                          aspect === a.key
                            ? "bg-accent-dim font-medium text-accent"
                            : "bg-panel text-text-2 hover:text-text-1"
                        }`}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-2">张数</span>
                  <div className="flex overflow-hidden rounded-sm border border-line">
                    {COUNTS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setCount(n)}
                        className={`cursor-pointer px-3 py-1 text-[11px] ${
                          count === n
                            ? "bg-accent-dim font-medium text-accent"
                            : "bg-panel text-text-2 hover:text-text-1"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {error && <p className="text-[12px] text-red">{error}</p>}
              <DialogActions>
                <button
                  type="button"
                  onClick={close}
                  className="cursor-pointer rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:text-text-1"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={busy || !prompt.trim()}
                  onClick={() => void submit()}
                  className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "入队中…" : "生成"}
                </button>
              </DialogActions>
            </div>
          )}
        </DialogShell>
      )}
    </>
  );
}
