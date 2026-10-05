"use client";

/**
 * 模型条目台账表(M8 批⑥;原型 Tab1):定位列由任务绑定派生(任一角色
 * 主力→默认/备用→备用),API Key 只回显掩码(无钥显「无鉴权」)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { BindingRow } from "@/lib/ai/bindings-admin";
import { AI_MODEL_PURPOSES, aiRoleLabel } from "@/lib/ai/constants";
import { formatCnDate } from "@/lib/datetime";
import type { AiModelRow } from "@/lib/ai/models-admin";
import type { ApiEnvelope } from "@/lib/http/response";

import ModelDialog from "./ModelDialog";
import TestStatusBadge from "./TestStatusBadge";

const opLink = "cursor-pointer text-xs text-text-2 hover:text-accent disabled:opacity-50";

/** 定位派生:id → (任一角色主力?)默认:(备用?)备用:— */
function derivePosition(id: number, bindings: BindingRow[]): "default" | "backup" | null {
  if (bindings.some((b) => b.primaryId === id)) return "default";
  if (bindings.some((b) => b.backupId === id)) return "backup";
  return null;
}

function Row({ model, bindings }: { model: AiModelRow; bindings: BindingRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const pos = derivePosition(model.id, bindings);
  const posRoles =
    pos === "default"
      ? bindings.filter((b) => b.primaryId === model.id).map((b) => aiRoleLabel(b.role))
      : bindings.filter((b) => b.backupId === model.id).map((b) => aiRoleLabel(b.role));

  async function call(url: string, init: RequestInit): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(url, init);
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) alert(body.message || `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  }

  const toggleEnabled = (): void => {
    void call(`/api/models/${model.id}/status`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !model.enabled }),
    });
  };

  const runTest = (): void => {
    void call(`/api/models/${model.id}/test`, { method: "POST" });
  };

  const remove = (): void => {
    if (!confirm(`确认删除模型「${model.name}」?被任务绑定引用时需先解绑。`)) return;
    void call(`/api/models/${model.id}`, { method: "DELETE" });
  };

  return (
    <tr
      className={`border-b border-line last:border-b-0 hover:bg-panel-2 ${model.enabled ? "" : "opacity-60"}`}
    >
      <td className="px-4 py-2.5">
        <div className="font-medium text-text-1">{model.name}</div>
        <div className="mt-0.5 text-[11px] text-text-3">{formatCnDate(model.createdAt)} 接入</div>
      </td>
      <td className="px-3 py-2.5 text-text-2">{model.provider}</td>
      <td className="px-3 py-2.5">
        <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
          {model.protocol}
        </span>
      </td>
      <td className="px-3 py-2.5 font-mono text-[12px] text-text-1">{model.modelId}</td>
      <td className="px-3 py-2.5">
        <div className="flex flex-wrap gap-1">
          {AI_MODEL_PURPOSES.filter((p) => model.purposes.includes(p)).map((p) => (
            <span key={p} className="rounded-sm bg-accent/10 px-1.5 py-px text-[10px] text-accent">
              {aiRoleLabel(p)}
            </span>
          ))}
        </div>
      </td>
      <td className="px-3 py-2.5 font-mono text-[11px] text-text-2" title="密文落库,只写不读">
        {model.apiKeyMask ?? "无鉴权"}
      </td>
      <td className="px-3 py-2.5">
        {pos === "default" ? (
          <span
            className="rounded-sm bg-accent/10 px-1.5 py-px text-[10px] text-accent"
            title={posRoles.join("、")}
          >
            默认
          </span>
        ) : pos === "backup" ? (
          <span
            className="rounded-sm bg-panel-2 px-1.5 py-px text-[10px] text-text-2"
            title={posRoles.join("、")}
          >
            备用
          </span>
        ) : (
          <span className="text-[11px] text-text-3">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <button
          type="button"
          role="switch"
          aria-checked={model.enabled}
          aria-label={`启用 ${model.name}`}
          disabled={busy}
          onClick={toggleEnabled}
          className={`relative h-[18px] w-8 cursor-pointer rounded-full transition-colors disabled:opacity-50 ${
            model.enabled ? "bg-accent" : "border border-line bg-panel-2"
          }`}
        >
          <span
            className={`absolute top-[2px] h-3.5 w-3.5 rounded-full bg-white transition-all ${
              model.enabled ? "left-[16px]" : "left-[2px]"
            }`}
          />
        </button>
      </td>
      <td className="px-3 py-2.5 text-[11px]">
        <TestStatusBadge
          status={model.lastTestStatus}
          latencyMs={model.lastTestLatencyMs}
          error={model.lastTestError}
        />
      </td>
      <td className="px-4 py-2.5 text-right">
        <div className="flex justify-end gap-2.5">
          <button type="button" disabled={busy} onClick={runTest} className={opLink}>
            测试
          </button>
          <ModelDialog label="编辑" model={model} buttonClass={opLink} />
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className="cursor-pointer text-xs text-red hover:opacity-80 disabled:opacity-50"
          >
            删除
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function ModelTable({
  models,
  bindings,
}: {
  models: AiModelRow[];
  bindings: BindingRow[];
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-panel">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line text-xs text-text-3">
            <th className="px-4 py-2.5 font-medium">名称</th>
            <th className="px-3 py-2.5 font-medium">供应商</th>
            <th className="px-3 py-2.5 font-medium">协议</th>
            <th className="px-3 py-2.5 font-medium">模型</th>
            <th className="px-3 py-2.5 font-medium">用途</th>
            <th className="px-3 py-2.5 font-medium">API Key</th>
            <th className="px-3 py-2.5 font-medium">定位</th>
            <th className="px-3 py-2.5 font-medium">启用</th>
            <th className="px-3 py-2.5 font-medium">最后测试</th>
            <th className="px-4 py-2.5 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <Row key={m.id} model={m} bindings={bindings} />
          ))}
          {models.length === 0 && (
            <tr>
              <td colSpan={10} className="px-4 py-10 text-center text-xs text-text-3">
                还没有模型,点右上角「新增模型」接入第一个供应商
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="border-t border-line px-4 py-2.5 font-mono text-[11px] text-text-3">
        GET/POST /api/models · PUT/DELETE /api/models/[id] · PUT /api/models/[id]/status · POST
        /api/models/[id]/test — Key 经 AES-256-GCM 加密落库,仅回显掩码;编辑留空表示不修改
      </div>
    </div>
  );
}
