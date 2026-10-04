"use client";

/**
 * ASR 渠道卡(M8 批⑥;原型 Tab2):单例配置描述网格 + 编辑弹窗 + 试测。
 * 试测为 1s 正弦波实调转写(无语音,转写文本为空属正常,防误报注明)。
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { AsrConfigView } from "@/lib/ai/asr-admin";

const field =
  "w-full rounded-sm border border-line bg-panel-2 px-2.5 py-2 text-sm text-text-1 outline-none focus:border-accent placeholder:text-text-3";

interface TestOutcome {
  ok: boolean;
  detail: string;
  skipped?: boolean;
}

function Lb({
  label,
  value,
  mono,
  title,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  title?: string;
}) {
  return (
    <>
      <div className="text-[11px] text-text-3">{label}</div>
      <div
        className={`truncate text-[12.5px] text-text-1 ${mono ? "font-mono" : ""}`}
        title={title}
      >
        {value}
      </div>
    </>
  );
}

export default function AsrCard({ asr }: { asr: AsrConfigView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);
  const providerRef = useRef<HTMLInputElement>(null);

  const close = (): void => {
    setOpen(false);
    setError(null);
    setApiKey("");
  };

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
      const body = (await res.json()) as { code: number; message: string };
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

  const runTest = async (): Promise<void> => {
    setTesting(true);
    setOutcome(null);
    try {
      const res = await fetch("/api/asr-config/test", { method: "POST" });
      const body = (await res.json()) as { code: number; message: string; data?: TestOutcome };
      if (body.code !== 0 || !body.data) {
        setOutcome({ ok: false, detail: body.message || `HTTP ${res.status}` });
        return;
      }
      setOutcome(body.data);
      router.refresh();
    } catch (e) {
      setOutcome({ ok: false, detail: String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-md border border-line bg-panel px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[12.5px] text-text-2">
          <svg className="ic text-accent" aria-hidden="true">
            <use href="#i-sound" />
          </svg>
          ASR 转写渠道 · {asr.enabled ? "已启用" : "未启用"}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setTimeout(() => providerRef.current?.focus(), 0);
            }}
            className="cursor-pointer rounded-sm border border-line px-2 py-1 text-[11px] text-text-2 hover:bg-panel-2"
          >
            编辑配置
          </button>
          <button
            type="button"
            disabled={testing}
            onClick={() => void runTest()}
            className="cursor-pointer rounded-sm bg-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {testing ? "测试中…" : "测试"}
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        <Lb label="供应商" value={asr.provider || "—"} />
        <Lb label="协议" value={asr.protocol} mono />
        <Lb label="模型" value={asr.modelId} mono />
        <Lb label="Base URL" value={asr.baseUrl ?? "—"} mono />
        <Lb label="单音频上限" value={`${asr.maxAudioSeconds}s`} mono />
        <Lb
          label="热词"
          value={asr.hotwords.length > 0 ? `${asr.hotwords.length} 条` : "—"}
          title={asr.hotwords.join("、")}
        />
        <Lb label="API Key" value={asr.apiKeyMask ?? "无鉴权"} mono />
        <Lb
          label="最后测试"
          value={
            asr.lastTestStatus === "ok" ? (
              <span className="text-green">✓ {asr.lastTestLatencyMs ?? "?"}ms</span>
            ) : asr.lastTestStatus === "fail" ? (
              <span className="cursor-help text-red" title={asr.lastTestError ?? undefined}>
                ✗ 失败
              </span>
            ) : (
              "未测试"
            )
          }
        />
      </div>

      <div className="mt-3 text-[11px] leading-relaxed text-text-3">
        <svg className="ic ic-sm mr-1 inline align-[-2px] text-text-3" aria-hidden="true">
          <use href="#i-infocircle" />
        </svg>
        测试为 1s 正弦波样本实调转写,<b className="text-text-2">转写文本为空属正常</b>;
        协议为「其他」时不支持测试。音频消费方执行转写即删,不落盘留存(arch/02 §3.2)。
      </div>

      {outcome && (
        <div
          className={`mt-2 font-mono text-xs ${outcome.skipped || !outcome.ok ? "text-red" : "text-green"}`}
        >
          {outcome.skipped ? "⊘ " : outcome.ok ? "✓ " : "✗ "}
          {outcome.detail}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-md border border-line bg-panel p-5 shadow-xl">
            <h3 className="text-sm font-semibold">编辑 ASR 配置</h3>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="text-xs text-text-3">
                供应商 *
                <input
                  ref={providerRef}
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
                API Key{" "}
                <span className="text-amber">(留空 = 保留 {asr.apiKeyMask ?? "现有密钥"})</span>
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
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
