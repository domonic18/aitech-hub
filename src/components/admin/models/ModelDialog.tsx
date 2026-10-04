"use client";

/**
 * 模型新增/编辑弹窗(M8 批⑥;原型 modal 同款字段组):
 * API Key write-only——创建可空(无鉴权内网网关),编辑留空 = 保留旧钥。
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { AI_MODEL_PURPOSES, AI_PROVIDER_PRESETS, aiRoleLabel } from "@/lib/ai/constants";
import type { AiModelRow } from "@/lib/ai/models-admin";
import { field } from "@/components/admin/form-fields";
import type { ApiEnvelope } from "@/lib/http/response";
import DialogShell, { DialogActions } from "@/components/admin/DialogShell";

const OTHER = "__other__";

export default function ModelDialog({
  label,
  model,
  buttonClass,
}: {
  label: string;
  model?: AiModelRow;
  buttonClass?: string;
}) {
  const router = useRouter();
  const editing = model !== undefined;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(model?.name ?? "");
  const [purposes, setPurposes] = useState<string[]>(model?.purposes ?? []);
  const [supportsVision, setSupportsVision] = useState(model?.supportsVision ?? false);
  const presetProvider = model?.provider;
  const [providerChoice, setProviderChoice] = useState(
    presetProvider && (AI_PROVIDER_PRESETS as readonly string[]).includes(presetProvider)
      ? presetProvider
      : (presetProvider ?? AI_PROVIDER_PRESETS[0]),
  );
  const [providerText, setProviderText] = useState(
    presetProvider && !(AI_PROVIDER_PRESETS as readonly string[]).includes(presetProvider)
      ? presetProvider
      : "",
  );
  const [protocol, setProtocol] = useState(model?.protocol ?? "openai");
  const [modelId, setModelId] = useState(model?.modelId ?? "");
  const [baseUrl, setBaseUrl] = useState(model?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [concurrency, setConcurrency] = useState(String(model?.concurrency ?? 4));
  const [timeoutSec, setTimeoutSec] = useState(String(model?.timeoutSec ?? 60));
  const nameRef = useRef<HTMLInputElement>(null);

  const close = (): void => {
    setOpen(false);
    setError(null);
    setApiKey("");
  };

  const togglePurpose = (p: string): void => {
    setPurposes((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  };

  const provider = providerChoice === OTHER ? providerText.trim() : providerChoice;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(editing ? `/api/models/${model.id}` : "/api/models", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          provider,
          protocol,
          baseUrl: baseUrl.trim() || null,
          modelId: modelId.trim(),
          apiKey: apiKey.trim() || null,
          purposes,
          supportsVision,
          concurrency: Number(concurrency),
          timeoutSec: Number(timeoutSec),
        }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      close();
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    name.trim() !== "" && modelId.trim() !== "" && purposes.length > 0 && provider !== "";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setTimeout(() => nameRef.current?.focus(), 0);
        }}
        className={
          buttonClass ??
          "cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
        }
      >
        {label}
      </button>
      {open && (
        <DialogShell width="2xl" scroll title={editing ? "编辑模型" : "新增模型"}>
          <label className="mt-3 block text-xs text-text-3">
            名称 *
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="如:解读主力 / Agent 搜索"
              className={`mt-1 ${field}`}
            />
          </label>

          <div className="mt-3 text-xs text-text-3">
            用途(可多选,至少一项)
            <div className="mt-1 flex flex-wrap gap-1.5">
              {AI_MODEL_PURPOSES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePurpose(p)}
                  aria-pressed={purposes.includes(p)}
                  className={`cursor-pointer rounded-sm border px-2 py-1 text-[11px] ${
                    purposes.includes(p)
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-line text-text-2 hover:bg-panel-2"
                  }`}
                >
                  {aiRoleLabel(p)}
                </button>
              ))}
            </div>
          </div>

          <label className="mt-3 flex items-center gap-2 text-xs text-text-2">
            <input
              type="checkbox"
              checked={supportsVision}
              onChange={(e) => setSupportsVision(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            支持视觉输入(图片/视频帧理解)
          </label>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-xs text-text-3">
              供应商 *
              <select
                value={providerChoice}
                onChange={(e) => setProviderChoice(e.target.value)}
                className={`mt-1 ${field}`}
              >
                {AI_PROVIDER_PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                <option value={OTHER}>其他</option>
              </select>
            </label>
            {providerChoice === OTHER && (
              <label className="text-xs text-text-3">
                供应商名称 *
                <input
                  value={providerText}
                  onChange={(e) => setProviderText(e.target.value)}
                  maxLength={20}
                  placeholder="如 OpenRouter"
                  className={`mt-1 ${field}`}
                />
              </label>
            )}
            <label className="text-xs text-text-3">
              协议 *
              <select
                value={protocol}
                onChange={(e) => setProtocol(e.target.value)}
                className={`mt-1 ${field}`}
              >
                <option value="openai">OpenAI 兼容</option>
                <option value="anthropic">Anthropic</option>
                <option value="other">其他(自管端点)</option>
              </select>
            </label>
            <label className="text-xs text-text-3">
              模型 ID *
              <input
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                maxLength={100}
                placeholder="如 deepseek-chat"
                className={`mt-1 font-mono ${field}`}
              />
            </label>
            <label className="col-span-2 text-xs text-text-3">
              Base URL
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                maxLength={500}
                placeholder="https://api.deepseek.com(可粘完整端点,自动剥尾缀)"
                className={`mt-1 font-mono ${field}`}
              />
            </label>
            <label className="col-span-2 text-xs text-text-3">
              API Key{" "}
              {editing && (
                <span className="text-amber">(留空 = 保留 {model.apiKeyMask ?? "现有密钥"})</span>
              )}
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                maxLength={400}
                placeholder="••••••••"
                autoComplete="new-password"
                className={`mt-1 font-mono ${field}`}
              />
              <span className="mt-1 block text-[11px] text-amber">
                保存后 AES-256-GCM 加密落库,界面仅回显掩码。
              </span>
            </label>
            <label className="text-xs text-text-3">
              最大并发(1-64)
              <input
                type="number"
                min={1}
                max={64}
                value={concurrency}
                onChange={(e) => setConcurrency(e.target.value)}
                className={`mt-1 ${field}`}
              />
            </label>
            <label className="text-xs text-text-3">
              超时(秒,5-600)
              <input
                type="number"
                min={5}
                max={600}
                value={timeoutSec}
                onChange={(e) => setTimeoutSec(e.target.value)}
                className={`mt-1 ${field}`}
              />
            </label>
          </div>

          {error && <p className="mt-2 font-mono text-xs text-red">{error}</p>}
          <DialogActions>
            <button
              type="button"
              onClick={close}
              className="cursor-pointer rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy || !canSubmit}
              onClick={() => void submit()}
              className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? "保存中…" : "保存"}
            </button>
          </DialogActions>
        </DialogShell>
      )}
    </>
  );
}
