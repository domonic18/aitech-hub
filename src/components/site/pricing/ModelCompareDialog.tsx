"use client";

/**
 * 模型对比弹窗(UX P3):并排对比 ≤4 个模型,行 × 列对齐。
 * 克隆 CompareDialog 的纯 CSS 弹窗模式(portal + Esc + 聚焦关闭键),
 * 前台不引入 Radix(SEO 红线)。
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import type { PublicModelRow } from "@/lib/pricing/public";
import { buildCompareMatrix } from "@/lib/pricing/model-compare";

export function ModelCompareDialog({
  models,
  onClose,
}: {
  models: PublicModelRow[];
  onClose: () => void;
}): React.ReactElement {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const matrix = buildCompareMatrix(models);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="模型对比"
    >
      <div
        className="max-h-[86vh] w-full max-w-4xl overflow-auto rounded-md border border-line bg-panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">模型对比({models.length} 个)</h3>
          <button
            ref={closeRef}
            type="button"
            aria-label="关闭"
            className="cursor-pointer text-text-3 hover:text-text-1"
            onClick={onClose}
          >
            <svg className="ic" aria-hidden="true">
              <use href="#i-close" />
            </svg>
          </button>
        </div>

        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="border-b border-line text-[11px] text-text-3">
              <th className="w-24 py-2 pr-3 font-normal">对比项</th>
              {models.map((m) => (
                <th
                  key={m.modelKey}
                  className="py-2 pr-3 font-mono text-[12px] font-semibold text-text-1"
                >
                  {m.modelDisplayName ?? m.modelKey}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row.label} className="border-b border-line/50 last:border-b-0">
                <td className="py-2 pr-3 text-text-3">{row.label}</td>
                {row.cells.map((cell, i) => (
                  <td key={i} className="break-words py-2 pr-3 text-text-1">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="py-2 pr-3 text-text-3">来源</td>
              {models.map((m) => (
                <td key={m.modelKey} className="py-2 pr-3">
                  <a
                    href={m.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue hover:text-blue/80"
                  >
                    官方页↗
                  </a>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>,
    document.body,
  );
}
