"use client";

/**
 * ASR 配置编辑弹窗(批C 从 AsrCard 拆出):表单态与提交仅弹窗内消费,
 * 卡片描述网格直接读 asr prop;每次挂载即打开,关闭即卸载(编辑态不残留)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AsrConfigView } from "@/lib/ai/asr-admin";
import { field } from "@/components/admin/form-fields";
import type { ApiEnvelope } from "@/lib/http/response";
import DialogShell, { DialogActions } from "@/components/admin/DialogShell";

export default function AsrDialog({ asr, onClose }: { asr: AsrConfigView; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState(asr.provider);
  const [protocol, setProtocol] = useState(asr.protocol);
  const [baseUrl, setBaseUrl] = useState(asr.baseUrl ?? "");
  const [modelId, setModelId] = useState(asr.modelId);
  const [apiKey, setApiKey] = useState("");
  const [maxAudioSeconds, setMaxAudioSeconds] = useState(String(asr.maxAudioSeconds));
  const [hotwords, setHotwords] = useState(asr.hotwords.join("、"));
  const [enabled, setEnabled] = useState(asr.enabled);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const words = hotwords
      .split(/[,、]/)
      .map((w) => w.trim())
      .filter(Boolean)
      .slice(0, 50);
    try {
      const res = await fetch("/api/asr-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: provider.trim(),
          protocol,
          baseUrl: baseUrl.trim() || null,
          modelId: modelId.trim(),
          apiKey: apiKey.trim() || null,
          maxAudioSeconds: Number(maxAudioSeconds),
          hotwords: words,
          enabled,
        }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      onClose();
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell width="xl" scroll title="编辑 ASR 配置">
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-xs text-text-3">
          供应商 *
          <input
            autoFocus
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            maxLength={50}
            placeholder="如 阿里云智能语音 / MiniMax"
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="text-xs text-text-3">
          协议 *
          <select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value)}
            className={`mt-1 ${field}`}
          >
            <option value="openai">OpenAI 兼容(/audio/transcriptions)</option>
            <option value="minimax">MiniMax(/v1/speech_to_text)</option>
            <option value="other">其他(不支持测试)</option>
          </select>
        </label>
        <label className="col-span-2 text-xs text-text-3">
          Base URL
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            maxLength={500}
            placeholder="https://asr.example.com(可粘完整端点,自动剥尾缀)"
            className={`mt-1 font-mono ${field}`}
          />
        </label>
        <label className="text-xs text-text-3">
          模型 *
          <input
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            maxLength={100}
            placeholder="如 whisper-1 / speech-02-hd"
            className={`mt-1 font-mono ${field}`}
          />
        </label>
        <label className="text-xs text-text-3">
          单音频上限(秒,10-7200)
          <input
            type="number"
            min={10}
            max={7200}
            value={maxAudioSeconds}
            onChange={(e) => setMaxAudioSeconds(e.target.value)}
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="col-span-2 text-xs text-text-3">
          API Key <span className="text-amber">(留空 = 保留 {asr.apiKeyMask ?? "现有密钥"})</span>
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
        <label className="col-span-2 text-xs text-text-3">
          热词(顿号/逗号分隔,至多 50 条)
          <input
            value={hotwords}
            onChange={(e) => setHotwords(e.target.value)}
            placeholder="如 大模型、智能体、多模态"
            className={`mt-1 ${field}`}
          />
        </label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs text-text-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="accent-[var(--accent)]"
        />
        启用该渠道(无消费方前建议保持关闭)
      </label>
      {error && <p className="mt-2 font-mono text-xs text-red">{error}</p>}
      <DialogActions>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
        >
          取消
        </button>
        <button
          type="button"
          disabled={busy || provider.trim() === "" || modelId.trim() === ""}
          onClick={() => void submit()}
          className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? "保存中…" : "保存"}
        </button>
      </DialogActions>
    </DialogShell>
  );
}
