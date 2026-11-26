"use client";

/**
 * 模型对比托盘:勾选模型后从底部浮出,列已选模型 + 清空 + 开始对比。
 * 与 Coding Plan 的 CompareTray 同构,但数据为 PublicModelRow。
 */
import { formatPrice, representativePrice, type PublicModelRow } from "@/lib/pricing/public";

export interface ModelCompareTrayProps {
  models: PublicModelRow[];
  onRemove: (key: string) => void;
  onClear: () => void;
  onOpen: () => void;
  limit: number;
}

function rowKey(r: PublicModelRow): string {
  return `${r.vendor}|${r.modelKey}`;
}

export function ModelCompareTray({
  models,
  onRemove,
  onClear,
  onOpen,
  limit,
}: ModelCompareTrayProps): React.ReactElement | null {
  if (models.length === 0) return null;
  const canOpen = models.length >= 2;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 shadow-lg backdrop-blur">
      <div className="mx-auto flex max-w-[var(--site-max-w)] flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2.5 pr-20">
        <span className="text-[11px] text-text-3">
          比价 <span className="font-mono text-text-2">{models.length}</span>/{limit}
        </span>
        {models.map((m) => (
          <span
            key={rowKey(m)}
            className="flex items-center gap-1 rounded-full border border-line bg-panel-2 px-2.5 py-1 text-[11.5px] text-text-1"
          >
            <span className="font-mono text-[10.5px] text-text-3">
              {formatPrice(representativePrice(m), m.currency)}
            </span>
            {m.modelKey}
            <button
              type="button"
              aria-label={`移出对比:${m.modelKey}`}
              className="ml-0.5 cursor-pointer text-text-3 hover:text-red"
              onClick={() => onRemove(rowKey(m))}
            >
              ×
            </button>
          </span>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="cursor-pointer text-[11.5px] text-text-3 hover:text-text-1"
            onClick={onClear}
          >
            清空
          </button>
          <button
            type="button"
            disabled={!canOpen}
            title={canOpen ? undefined : "至少勾选 2 个模型才能对比"}
            className="cursor-pointer rounded-md bg-accent px-3 py-1.5 text-[12px] text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            onClick={onOpen}
          >
            开始对比
          </button>
        </div>
      </div>
    </div>
  );
}
