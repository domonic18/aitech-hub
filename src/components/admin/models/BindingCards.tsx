"use client";

/**
 * 任务绑定四角色卡(M8 批⑥;原型 Tab3):主力/备用下拉(仅启用且用途匹配
 * 的模型可选),备用可为空;校验不过服务端返回 400 文案原样展示。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { BindingRow } from "@/lib/ai/bindings-admin";
import { AI_MODEL_PURPOSES, AI_ROLE_META, type AiTaskRole } from "@/lib/ai/constants";
import type { AiModelRow } from "@/lib/ai/models-admin";
import type { ApiEnvelope } from "@/lib/http/response";

const selectField =
  "w-full rounded-sm border border-line bg-panel-2 px-2 py-1.5 text-xs text-text-1 outline-none focus:border-accent";

function RoleCard({
  role,
  binding,
  models,
}: {
  role: AiTaskRole;
  binding: BindingRow | undefined;
  models: AiModelRow[];
}) {
  const router = useRouter();
  const meta = AI_ROLE_META[role];
  const eligible = models.filter((m) => m.enabled && m.purposes.includes(role));
  const [primary, setPrimary] = useState(
    binding?.primaryId != null ? String(binding.primaryId) : "",
  );
  const [backup, setBackup] = useState(binding?.backupId != null ? String(binding.backupId) : "");
  // 解读日配额(M9 后台化,原 INTERPRETER_DAILY_MAX env):仅 interpret 卡出现,空=默认 100
  const [quota, setQuota] = useState(binding?.dailyMax != null ? String(binding.dailyMax) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const primaryId = primary === "" ? null : Number(primary);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/model-bindings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role,
          primaryId,
          backupId: backup === "" ? null : Number(backup),
          dailyMax: quota === "" ? null : Number(quota),
        }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      setNotice("已保存");
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const testPrimary = async (): Promise<void> => {
    if (primaryId === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/models/${primaryId}/test`, { method: "POST" });
      const body = (await res.json()) as {
        code: number;
        message: string;
        data?: { ok: boolean; detail: string; skipped?: boolean };
      };
      if (body.code !== 0 || !body.data) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      setNotice(`${body.data.ok ? "✓" : "✗"} ${body.data.detail}`);
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="group"
      aria-label={`${meta.label}绑定`}
      className="rounded-md border border-line bg-panel p-4"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-accent/10 text-accent">
          <svg className="ic ic-sm" aria-hidden="true">
            <use href={`#${meta.icon}`} />
          </svg>
        </span>
        <b className="text-[13px] text-text-1">{meta.label}</b>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-text-3">{meta.sub}</p>
      <label className="mt-3 block text-[11px] text-text-3">
        主力
        <select
          value={primary}
          onChange={(e) => setPrimary(e.target.value)}
          aria-label={`${meta.label}主力模型`}
          className={`mt-1 ${selectField}`}
        >
          <option value="">— 未绑定 —</option>
          {eligible.map((m) => (
            <option key={m.id} value={m.id}>
              {m.modelId}({m.provider})
            </option>
          ))}
        </select>
      </label>
      <label className="mt-2 block text-[11px] text-text-3">
        备用
        <select
          value={backup}
          onChange={(e) => setBackup(e.target.value)}
          aria-label={`${meta.label}备用模型`}
          className={`mt-1 ${selectField}`}
        >
          <option value="">— 无备用 —</option>
          {eligible.map((m) => (
            <option key={m.id} value={m.id}>
              {m.modelId}({m.provider})
            </option>
          ))}
        </select>
      </label>
      {role === "interpret" && (
        // 日配额(条/日):超限延迟 30min 重投顺延,消费方在 worker;留空=默认 100
        <label className="mt-2 block text-[11px] text-text-3">
          日配额(条/日,留空=默认 100)
          <input
            type="number"
            min={1}
            step={1}
            value={quota}
            onChange={(e) => setQuota(e.target.value)}
            aria-label="解读日配额"
            placeholder="100"
            className={`mt-1 ${selectField}`}
          />
        </label>
      )}
      {error && <p className="mt-2 font-mono text-[11px] text-red">{error}</p>}
      {notice && <p className="mt-2 font-mono text-[11px] text-text-2">{notice}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          disabled={busy || primaryId === null}
          onClick={() => void testPrimary()}
          className="cursor-pointer rounded-sm border border-line px-2.5 py-1.5 text-[11px] text-text-2 hover:bg-panel-2 disabled:opacity-50"
        >
          测试主力
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="cursor-pointer rounded-sm bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? "处理中…" : "保存"}
        </button>
      </div>
    </div>
  );
}

export default function BindingCards({
  models,
  bindings,
}: {
  models: AiModelRow[];
  bindings: BindingRow[];
}) {
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {AI_MODEL_PURPOSES.map((role) => (
          <RoleCard
            key={role}
            role={role}
            binding={bindings.find((b) => b.role === role)}
            models={models}
          />
        ))}
      </div>
      <p className="mt-3 font-mono text-[11px] text-text-3">
        GET/PUT /api/model-bindings — 下拉仅列「启用且用途匹配」的模型;主力停用后解析层自动回落备用
        (额度降级切换归 M9 消费方)。
      </p>
    </div>
  );
}
