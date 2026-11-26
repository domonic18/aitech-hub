"use client";

/**
 * 模型对比托盘(UX P3):勾选模型后从底部浮出,列已选 + 清空 + 开始对比。
 * 克隆 CompareTray 模式;z-30 低于 AI 助手 FAB(z-40)。
 */
import type { PublicModelRow } from "@/lib/pricing/public";
import { representativePrice, formatPrice } from "@/lib/pricing/public";

export interface ModelCompareTrayProps {
  models: PublicModelRow[];
  onRemove: (key: string) => void;
  onClear: () => void;
  onOpen: () => void;
  limit: number;
}

export function modelCompareKey(r: PublicModelRow): string {
  return r.modelGroupKey ?? r.modelDictKey ?? `${r.vendor}|${r.modelKey}`;
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
          对比 <span className="font-mono text-text-2">{models.length}</span>/{limit}
        </span>
        {models.map((m) => (
          <span
            key={modelCompareKey(m)}
            className="flex items-center gap-1 rounded-full border border-line bg-panel-2 px-2.5 py-1 text-[11.5px] text-text-1"
          >
            <span className="font-mono text-[10.5px] text-text-3">
              {formatPrice(representativePrice(m), m.currency)}
            </span>
            {m.modelDisplayName ?? m.modelKey}
            <button
              type="button"
              aria-label={`移出对比:${m.modelKey}`}
              className="ml-0.5 cursor-pointer text-text-3 hover:text-red"
              onClick={() => onRemove(modelCompareKey(m))}
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
            title={canOpen ? undefined : "至少勾选 2 个模型"}
            className="cursor-pointer rounded-sm bg-accent px-3 py-1 text-[11.5px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={onOpen}
          >
            开始对比
          </button>
        </div>
      </div>
    </div>
  );
}
