"use client";

/**
 * 对比托盘(验收问题三):勾选套餐后从底部浮出,列已选套餐 + 清空 + 开始对比。
 * z-30 低于 AI 助手 FAB(z-40),内层右侧留出 FAB 位(pr-20)避免遮住按钮。
 */
import { formatPrice, type PublicPlanRow } from "@/lib/pricing/public";

export interface CompareTrayProps {
  plans: PublicPlanRow[];
  onRemove: (key: string) => void;
  onClear: () => void;
  onOpen: () => void;
  limit: number;
}

export function CompareTray({
  plans,
  onRemove,
  onClear,
  onOpen,
  limit,
}: CompareTrayProps): React.ReactElement | null {
  if (plans.length === 0) return null;
  const canOpen = plans.length >= 2;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 shadow-lg backdrop-blur">
      <div className="mx-auto flex max-w-[var(--site-max-w)] flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2.5 pr-20">
        <span className="text-[11px] text-text-3">
          比价 <span className="font-mono text-text-2">{plans.length}</span>/{limit}
        </span>
        {plans.map((p) => (
          <span
            key={`${p.vendor}|${p.planName}`}
            className="flex items-center gap-1 rounded-full border border-line bg-panel-2 px-2.5 py-1 text-[11.5px] text-text-1"
          >
            <span className="font-mono text-[10.5px] text-text-3">
              {formatPrice(p.monthlyFee, p.currency)}
            </span>
            {p.planName}
            <button
              type="button"
              aria-label={`移出对比:${p.planName}`}
              className="ml-0.5 cursor-pointer text-text-3 hover:text-red"
              onClick={() => onRemove(`${p.vendor}|${p.planName}`)}
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
            title={canOpen ? undefined : "至少勾选 2 个套餐才能对比"}
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
