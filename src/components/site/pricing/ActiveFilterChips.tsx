"use client";

/**
 * 活跃筛选 chips 条(UX P1):把当前所有已生效筛选以可移除 chip 形式呈现,
 * 类比电商「已选条件:×× ×」。每 chip × 移除单项,尾部「清空全部」。
 * 纯客户端派生(SSR 默认态无 chips,不占位)。
 */
import type { PricingQueryState } from "@/lib/pricing/query";
import { FREE_SCOPE_OPTIONS, MODEL_CAT_OPTIONS, PRICE_BANDS } from "@/lib/pricing/public";
import { PROTOCOL_CHIP_LABELS } from "@/lib/pricing/protocols";

/** 筛选相关的字段子集(view/panel/scenario 是视图模式,不算筛选 chips) */
type FilterState = Pick<
  PricingQueryState,
  "vendors" | "band" | "freeScope" | "cat" | "contextBand" | "sourceKind" | "q" | "protocols"
>;

interface Chip {
  key: string;
  label: string;
  remove: Partial<PricingQueryState>;
}

function bandLabel(id: string): string {
  return PRICE_BANDS.find((b) => b.id === id)?.label ?? id;
}

function catLabel(id: string): string {
  return MODEL_CAT_OPTIONS.find((c) => c.id === id)?.label ?? id;
}

function freeLabel(id: string): string {
  return FREE_SCOPE_OPTIONS.find((f) => f.id === id)?.label ?? id;
}

/** 从筛选态派生 chips(默认值不产生 chip) */
export function deriveFilterChips(state: FilterState): Chip[] {
  const chips: Chip[] = [];
  if (state.q !== "") {
    chips.push({ key: "q", label: `“${state.q}”`, remove: { q: "" } });
  }
  for (const v of state.vendors) {
    chips.push({
      key: `v:${v}`,
      label: v,
      remove: { vendors: state.vendors.filter((x) => x !== v) },
    });
  }
  if (state.band !== "all") {
    chips.push({ key: "band", label: bandLabel(state.band), remove: { band: "all" } });
  }
  if (state.freeScope !== "all") {
    chips.push({ key: "free", label: freeLabel(state.freeScope), remove: { freeScope: "all" } });
  }
  if (state.cat !== "text") {
    chips.push({ key: "cat", label: catLabel(state.cat), remove: { cat: "text" } });
  }
  if (state.contextBand !== "all") {
    chips.push({
      key: "ctx",
      label: `上下文 ${state.contextBand}`,
      remove: { contextBand: "all" },
    });
  }
  if (state.sourceKind !== "") {
    chips.push({
      key: "src",
      label: state.sourceKind === "official" ? "官方一手价" : "聚合平台价",
      remove: { sourceKind: "" },
    });
  }
  for (const p of state.protocols) {
    chips.push({
      key: `proto:${p}`,
      label: PROTOCOL_CHIP_LABELS[p],
      remove: { protocols: state.protocols.filter((x) => x !== p) },
    });
  }
  return chips;
}

export function ActiveFilterChips({
  state,
  onPatch,
  onReset,
}: {
  state: FilterState;
  onPatch: (patch: Partial<FilterState>) => void;
  onReset: () => void;
}): React.ReactElement | null {
  const chips = deriveFilterChips(state);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-panel-2/30 px-4 py-2 text-[11px]">
      <span className="mr-0.5 text-text-3">已选</span>
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          className="group inline-flex cursor-pointer items-center gap-1 rounded-full border border-line bg-panel px-2 py-0.5 text-text-2 hover:border-line-hover hover:text-text-1"
          onClick={() => onPatch(c.remove)}
        >
          {c.label}
          <svg className="ic h-3 w-3 text-text-3 group-hover:text-text-1" aria-hidden="true">
            <use href="#i-close" />
          </svg>
        </button>
      ))}
      <button
        type="button"
        className="ml-auto cursor-pointer text-text-3 underline-offset-2 hover:text-text-1 hover:underline"
        onClick={onReset}
      >
        清空全部
      </button>
    </div>
  );
}
