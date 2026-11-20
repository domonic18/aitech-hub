"use client";

/**
 * 模型面「更多筛选」(M74 批C;批G 模态细筛升级为顶部用途页签,此处退役):
 * 上下文长度 / 来源类型 / 排序。
 *
 * 折叠在 `<details>` 里(零 JS 展开,首屏不被筛选控件撑满)——常驻区只留
 * 厂商、价格区间与「只看免费」三个最常用维度。上下文档对非文本用途组
 * (文生图/视频等)无意义,组内隐藏。
 */
import { CONTEXT_BANDS, type ContextBandId } from "@/lib/pricing/context";
import {
  MODEL_SORT_OPTIONS,
  SOURCE_KIND_OPTIONS,
  type ModelCatId,
  type ModelSortId,
} from "@/lib/pricing/public";

import { CHIP_BASE, CHIP_OFF, CHIP_ON } from "./shared";

interface ChipGroupProps<T extends string> {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}

function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: ChipGroupProps<T>): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="mr-1 text-[10.5px] text-text-3">{label}</span>
      {options.map((o) => (
        <button
          key={o.id === "" ? "__all" : o.id}
          type="button"
          aria-pressed={value === o.id}
          className={`${CHIP_BASE} ${value === o.id ? CHIP_ON : CHIP_OFF}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface ModelFiltersProps {
  /** 用途分组(批G):非文本组隐藏上下文档(文生图/视频无上下文概念) */
  cat: ModelCatId;
  contextBand: ContextBandId;
  onContextBandChange: (v: ContextBandId) => void;
  sourceKind: string;
  onSourceKindChange: (v: string) => void;
  sort: ModelSortId;
  onSortChange: (v: ModelSortId) => void;
}

export function ModelFilters({
  cat,
  contextBand,
  onContextBandChange,
  sourceKind,
  onSourceKindChange,
  sort,
  onSortChange,
}: ModelFiltersProps): React.ReactElement {
  const showContext = cat === "text" || cat === "all";
  return (
    <details className="border-t border-line/60 px-4 py-2">
      <summary className="cursor-pointer select-none text-[11px] text-text-3 hover:text-text-2">
        更多筛选({showContext ? "上下文 / " : ""}来源 / 排序)
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {showContext && (
          <ChipGroup
            label="上下文"
            options={CONTEXT_BANDS}
            value={contextBand}
            onChange={onContextBandChange}
          />
        )}
        <ChipGroup
          label="来源"
          options={SOURCE_KIND_OPTIONS}
          value={sourceKind}
          onChange={onSourceKindChange}
        />
        <ChipGroup label="排序" options={MODEL_SORT_OPTIONS} value={sort} onChange={onSortChange} />
      </div>
    </details>
  );
}
