"use client";

/**
 * 工作台右上双入口(M41):「新建贴图」空贴图直达组装台;「AI 生成贴图」
 * 弹窗填提示词 → 建贴图 + 入队 illustration-studio(带 pinId,出图自动挂
 * 序列尾)→ 进组装台轮询。attempts=1 计费不重试;单批 ≤3 张。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import DialogShell, { DialogActions } from "@/components/admin/DialogShell";

import { ILLUSTRATE_ASPECT_OPTIONS } from "@/lib/ai/constants";

import { callPinApi, JSON_HEADERS } from "./api";

const ASPECTS = ILLUSTRATE_ASPECT_OPTIONS;

export default function PinCreateButtons(): React.ReactElement {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<string>("3:4");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  async function createBlank() {
    setCreating(true);
    setError(null);
    try {
      const body = await callPinApi<{ id: string }>("/api/pins", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ title: "未命名贴图" }),
      });
      if (body.code !== 0 || !body.data) setError(body.message);
      else router.push(`/admin/pins/${body.data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络异常");
    } finally {
      setCreating(false);
    }
  }

  async function submitGenerate() {
    setBusy(true);
    setError(null);
    try {
      const created = await callPinApi<{ id: string }>("/api/pins", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ title: title.trim() || "未命名贴图" }),
      });
      if (created.code !== 0 || !created.data) {
        setError(created.message);
        return;
      }
      const pinId = created.data.id;
      setCreatedId(pinId);
      const gen = await callPinApi<{ jobId: string }>(`/api/pins/${pinId}/generate`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ prompt: prompt.trim(), aspect, count }),
      });
      if (gen.code !== 0) {
        setError(gen.message);
        return;
      }
      setGenOpen(false);
      router.push(`/admin/pins/${pinId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络异常");
    } finally {
      setBusy(false);
    }
  }

  function closeGen() {
    setGenOpen(false);
    setError(null);
    setPrompt("");
    setTitle("");
    setCreatedId(null);
  }

  const btn =
    "inline-flex cursor-pointer items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium";
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={creating}
        onClick={() => void createBlank()}
        className={`${btn} border border-line bg-panel text-text-1 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <svg className="ic" aria-hidden="true">
          <use href="#i-plus" />
        </svg>
        {creating ? "创建中…" : "新建贴图"}
      </button>
      <button
        type="button"
        onClick={() => setGenOpen(true)}
        className={`${btn} bg-accent text-white hover:bg-accent-hover`}
      >
        <svg className="ic" aria-hidden="true">
          <use href="#i-robot" />
        </svg>
        AI 生成贴图
      </button>

      {genOpen && (
        <DialogShell title="AI 生成贴图" scroll>
          <div className="mt-3 flex flex-col gap-3">
            <div>
              <label className="text-xs text-text-2" htmlFor="pin-gen-title">
                标题(可留空,默认「未命名贴图」,上限 32 字)
              </label>
              <input
                id="pin-gen-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={32}
                className="mt-1 w-full rounded-sm border border-line bg-panel-2 px-2.5 py-2 text-[13px] text-text-1 outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="text-xs text-text-2" htmlFor="pin-gen-prompt">
                出图提示词
              </label>
              <textarea
                id="pin-gen-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="例:一图看懂 RAG 检索增强流程,扁平插画,深色底,中文标注…"
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
                  {[1, 2, 3].map((n) => (
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
            {error && (
              <p className="text-[12px] text-red">
                {error}
                {createdId && (
                  <>
                    {" · "}
                    <a href={`/admin/pins/${createdId}`} className="text-accent hover:underline">
                      仍前往组装台
                    </a>
                  </>
                )}
              </p>
            )}
            <DialogActions>
              <button
                type="button"
                onClick={closeGen}
                className="cursor-pointer rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:text-text-1"
              >
                取消
              </button>
              <button
                type="button"
                disabled={busy || !prompt.trim()}
                onClick={() => void submitGenerate()}
                className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "入队中…" : "生成并进入组装台"}
              </button>
            </DialogActions>
          </div>
        </DialogShell>
      )}
    </span>
  );
}
