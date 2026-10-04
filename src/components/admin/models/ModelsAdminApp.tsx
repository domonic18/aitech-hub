"use client";

/**
 * AI 服务治理三 Tab 客户端岛(M8 批⑥;原型 admin-models.html):
 * 模型条目 / ASR 渠道 / 任务绑定。数据由 RSC 注入,变更后 router.refresh()。
 */
import { useState } from "react";

import type { AsrConfigView } from "@/lib/ai/asr-admin";
import type { BindingRow } from "@/lib/ai/bindings-admin";
import type { AiModelRow } from "@/lib/ai/models-admin";

import AsrCard from "./AsrCard";
import BindingCards from "./BindingCards";
import ModelDialog from "./ModelDialog";
import ModelTable from "./ModelTable";

type Tab = "models" | "asr" | "bind";

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "models", label: "模型条目" },
  { key: "asr", label: "ASR 渠道" },
  { key: "bind", label: "任务绑定" },
];

export default function ModelsAdminApp({
  models,
  asr,
  bindings,
}: {
  models: AiModelRow[];
  asr: AsrConfigView;
  bindings: BindingRow[];
}) {
  const [tab, setTab] = useState<Tab>("models");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">模型配置</h2>
        <p className="mt-0.5 text-xs text-text-3">
          AI 服务治理:模型按用途接入,任务经「任务绑定」解析主力/备用;API Key
          服务端加密存储,界面仅回显掩码(编辑留空表示不修改)。
        </p>
      </div>

      <div className="flex items-center gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-selected={tab === t.key}
            role="tab"
            className={`-mb-px cursor-pointer border-b-2 px-3 py-2 text-[13px] ${
              tab === t.key
                ? "border-accent font-medium text-accent"
                : "border-transparent text-text-2 hover:text-text-1"
            }`}
          >
            {t.label}
            {t.key === "models" && models.length > 0 && (
              <span className="ml-1.5 rounded-sm bg-panel-2 px-1 py-px font-mono text-[10px] text-text-3">
                {models.length}
              </span>
            )}
          </button>
        ))}
        <span className="ml-auto pb-2">
          <ModelDialog label="+ 新增模型" />
        </span>
      </div>

      {tab === "models" && <ModelTable models={models} bindings={bindings} />}
      {tab === "asr" && <AsrCard asr={asr} />}
      {tab === "bind" && <BindingCards models={models} bindings={bindings} />}
    </div>
  );
}
