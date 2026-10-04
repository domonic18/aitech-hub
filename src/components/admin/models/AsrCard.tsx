"use client";

/**
 * ASR 渠道卡(M8 批⑥;原型 Tab2):单例配置描述网格 + 编辑弹窗 + 试测。
 * 试测为 1s 正弦波实调转写(无语音,转写文本为空属正常,防误报注明)。
 * 编辑弹窗见同级 AsrDialog(表单态弹窗内闭环)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AsrConfigView } from "@/lib/ai/asr-admin";

import AsrDialog from "./AsrDialog";
import TestStatusBadge from "./TestStatusBadge";
import type { ApiEnvelope } from "@/lib/http/response";

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
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);

  const runTest = async (): Promise<void> => {
    setTesting(true);
    setOutcome(null);
    try {
      const res = await fetch("/api/asr-config/test", { method: "POST" });
      const body = (await res.json()) as ApiEnvelope<TestOutcome | null>;
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
            onClick={() => setOpen(true)}
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
            <TestStatusBadge
              status={asr.lastTestStatus}
              latencyMs={asr.lastTestLatencyMs}
              error={asr.lastTestError}
            />
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

      {open && <AsrDialog asr={asr} onClose={() => setOpen(false)} />}
    </div>
  );
}
