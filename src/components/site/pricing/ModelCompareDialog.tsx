"use client";

/**
 * 模型对比弹窗:并排对比 ≤4 个模型,行 × 列对齐。
 * 纯 CSS 弹窗(portal + Esc + 聚焦关闭键),前台不引入 Radix(SEO 红线)。
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import type { PublicModelRow } from "@/lib/pricing/public";
import { buildCompareMatrix, PROTOCOL_ROW_LABEL } from "@/lib/pricing/model-compare";
import { ProtocolBadges } from "./shared";

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
        className="max-h-[86vh] w-full max-w-5xl overflow-hidden rounded-md border border-line bg-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel px-5 py-3">
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

        <div className="overflow-auto p-5">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-line text-[11px] text-text-3">
                <th className="sticky left-0 z-10 w-28 bg-panel py-2 pr-3 font-normal">对比项</th>
                {models.map((m) => (
                  <th
                    key={m.modelKey}
                    className="min-w-[160px] py-2 pr-3 font-mono text-[12px] font-semibold text-text-1"
                  >
                    {m.modelDisplayName ?? m.modelKey}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.label} className="border-b border-line/50 last:border-b-0">
                  <td className="sticky left-0 z-10 bg-panel py-2 pr-3 text-text-3">{row.label}</td>
                  {row.cells.map((cell, i) => (
                    <td key={i} className="min-w-[160px] break-words py-2 pr-3 text-text-1">
                      {row.label === PROTOCOL_ROW_LABEL ? (
                        <ProtocolBadges protocols={models[i]?.protocols ?? []} />
                      ) : (
                        cell
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className="sticky left-0 z-10 bg-panel py-2 pr-3 text-text-3">来源</td>
                {models.map((m) => (
                  <td key={m.modelKey} className="min-w-[160px] py-2 pr-3">
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
      </div>
    </div>,
    document.body,
  );
}
