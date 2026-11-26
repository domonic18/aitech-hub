"use client";

/**
 * 模型对比选择器(京东式对比入口):
 * 在「比价」视图内独立选择 2–4 个模型,点击「开始对比」打开并排参数弹窗。
 * 不依赖列表行的 checkbox,选择状态自持。
 */
import { useMemo, useState } from "react";

import type { PublicModelRow } from "@/lib/pricing/public";
import { formatPrice, representativePrice } from "@/lib/pricing/public";
import { MODEL_COMPARE_LIMIT } from "@/lib/pricing/model-compare";

import { ModelCompareDialog } from "./ModelCompareDialog";

function modelKeyForCompare(r: PublicModelRow): string {
  return `${r.vendor}|${r.modelKey}`;
}

function matchesModelQuery(r: PublicModelRow, q: string): boolean {
  const term = q.trim().toLowerCase();
  if (term === "") return true;
  return (
    r.modelKey.toLowerCase().includes(term) ||
    (r.modelDisplayName?.toLowerCase().includes(term) ?? false) ||
    r.vendor.toLowerCase().includes(term) ||
    (r.modelFamily?.toLowerCase().includes(term) ?? false)
  );
}

export function ModelComparePanel({ models }: { models: PublicModelRow[] }): React.ReactElement {
  const [selected, setSelected] = useState<PublicModelRow[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const available = useMemo(
    () =>
      models
        .filter((m) => !selected.some((s) => modelKeyForCompare(s) === modelKeyForCompare(m)))
        .filter((m) => matchesModelQuery(m, query))
        .slice(0, 8),
    [models, selected, query],
  );

  const canAdd = selected.length < MODEL_COMPARE_LIMIT;
  const canOpen = selected.length >= 2;

  const addModel = (m: PublicModelRow): void => {
    if (!canAdd) return;
    setSelected((prev) =>
      prev.some((s) => modelKeyForCompare(s) === modelKeyForCompare(m)) ? prev : [...prev, m],
    );
    setQuery("");
  };

  const removeModel = (m: PublicModelRow): void => {
    const key = modelKeyForCompare(m);
    setSelected((prev) => prev.filter((s) => modelKeyForCompare(s) !== key));
  };

  return (
    <div className="border-b border-line px-4 py-5">
      <div className="mb-4">
        <h2 className="text-[13px] font-semibold text-text-1">模型参数对比</h2>
        <p className="mt-1 text-[11.5px] text-text-3">
          选择 {MODEL_COMPARE_LIMIT} 个以内模型,并排对比价格、上下文、协议等参数。
        </p>
      </div>

      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-text-3">已选</span>
          {selected.map((m) => (
            <span
              key={modelKeyForCompare(m)}
              className="flex items-center gap-1 rounded-full border border-line bg-panel-2 px-2.5 py-1 text-[11.5px] text-text-1"
            >
              <span className="font-mono text-[10.5px] text-text-3">
                {formatPrice(representativePrice(m), m.currency)}
              </span>
              {m.modelKey}
              <button
                type="button"
                aria-label={`移除:${m.modelKey}`}
                className="ml-0.5 cursor-pointer text-text-3 hover:text-red"
                onClick={() => removeModel(m)}
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            className="cursor-pointer text-[11px] text-text-3 underline-offset-2 hover:text-text-1 hover:underline"
            onClick={() => {
              setSelected([]);
              setQuery("");
            }}
          >
            清空
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={canAdd ? "搜索模型名、厂商…" : "已选满,请先移除"}
          disabled={!canAdd}
          className="w-64 rounded-sm border border-line bg-panel-2 px-2.5 py-1.5 text-[12px] outline-none focus:border-accent disabled:opacity-50"
        />
        {available.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {available.map((m) => (
              <button
                key={modelKeyForCompare(m)}
                type="button"
                onClick={() => addModel(m)}
                className="cursor-pointer rounded-full border border-line bg-panel px-2.5 py-1 text-[11px] text-text-2 hover:border-line-hover hover:text-text-1"
              >
                <span className="font-mono text-[10px] text-text-3">
                  {formatPrice(representativePrice(m), m.currency)}
                </span>{" "}
                {m.modelKey}
              </button>
            ))}
          </div>
        )}
      </div>

      {query.length > 0 && available.length === 0 && (
        <p className="mt-2 text-[11px] text-text-3">无匹配模型</p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={!canOpen}
          onClick={() => setOpen(true)}
          className="cursor-pointer rounded-sm bg-accent px-4 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          开始对比
        </button>
        {!canOpen && <span className="text-[11px] text-amber">请至少选择 2 个模型</span>}
      </div>

      {open && selected.length >= 2 && (
        <ModelCompareDialog models={selected} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
