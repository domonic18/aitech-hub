"use client";

/**
 * 左侧筛选栏(2026-11-18 站长反馈问题一):lg+ 屏把筛选从顶部 chips 改到左侧
 * 常驻栏——维度一目了然,厂商清单(聚合源上线后 30+ 家)可搜索、可滚动,
 * 不再把内容压到两屏之下。移动端(< lg)仍走顶部 FilterBar,两种形态共用
 * 同一份筛选状态(PricingExplorer 单源)。
 *
 * 纪律不变:纯客户端筛选,SSR 首屏仍渲染全量行(hidden 藏),SEO 红线不破。
 *
 * 厂商清单由 ModelSection **按当前用途组收边**(facet):视频-only 厂商不出
 * 现在「文本」页签(2026-11-18 反馈:勾了零结果像数据丢了)。切换页签后
 * 已勾但不在当前清单的厂商以「已勾(当前用途组无模型)」段显形,可取消。
 *
 * 免费口径(2026-11-18 反馈:想筛「免费额度里有明确额度的」却没得筛):
 * 单选四态——全部 / 完全免费 / 有免费额度 / 任一免费(并集),各档带行数;
 * 老的「只看免费」开关只认完全免费,而有额度的行占多数(测试库 1 : 72)。
 */
import { useMemo, useState } from "react";

import { CONTEXT_BANDS, type ContextBandId } from "@/lib/pricing/context";
import {
  FREE_SCOPE_OPTIONS,
  MODEL_CAT_OPTIONS,
  MODEL_SORT_OPTIONS,
  PRICE_BANDS,
  SOURCE_KIND_OPTIONS,
  type FreeScopeId,
  type ModelCatId,
  type ModelSortId,
  type PriceBandId,
} from "@/lib/pricing/public";
import { PROTOCOL_OPTIONS, type ApiProtocol } from "@/lib/pricing/protocols";

/** 侧栏分组标题 */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line/60 px-3.5 py-3 first:border-t-0">
      <div className="mb-2 text-[11px] font-medium text-text-2">{title}</div>
      {children}
    </div>
  );
}

/** 单选 chip 组(侧栏窄列纵向排布更省空间) */
function RadioChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id === "" ? "__all" : o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-full border px-2 py-[3px] text-[11px] leading-none transition-colors cursor-pointer select-none ${
            value === o.id
              ? "border-accent bg-accent text-white"
              : "border-line bg-panel text-text-2 hover:border-line-hover hover:text-text-1"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface FilterSidebarProps {
  cat: ModelCatId;
  onCatChange: (v: ModelCatId) => void;
  vendors: string[];
  selectedVendors: string[];
  onVendorsChange: (v: string[]) => void;
  band: PriceBandId;
  onBandChange: (b: PriceBandId) => void;
  contextBand: ContextBandId;
  onContextBandChange: (v: ContextBandId) => void;
  sourceKind: string;
  onSourceKindChange: (v: string) => void;
  /** 协议多选(空 = 全部) */
  protocols: ApiProtocol[];
  onProtocolsChange: (v: ApiProtocol[]) => void;
  /** 免费口径(单选四态;两种免费语义分开,组合另设一档) */
  freeScope: FreeScopeId;
  onFreeScopeChange: (v: FreeScopeId) => void;
  /** 各口径的行数(展示用:让用户先看到「有多少行」再选) */
  freeCounts: Record<FreeScopeId, number>;
  sort: ModelSortId;
  onSortChange: (v: ModelSortId) => void;
  /** 区间口径说明(随用途组切换) */
  priceLabel: string;
  total: number;
  shown: number;
}

export function FilterSidebar({
  cat,
  onCatChange,
  vendors,
  selectedVendors,
  onVendorsChange,
  band,
  onBandChange,
  contextBand,
  onContextBandChange,
  sourceKind,
  onSourceKindChange,
  protocols,
  onProtocolsChange,
  freeScope,
  onFreeScopeChange,
  freeCounts,
  sort,
  onSortChange,
  priceLabel,
  total,
  shown,
}: FilterSidebarProps): React.ReactElement {
  const [vendorQuery, setVendorQuery] = useState("");
  const shownVendors = useMemo(() => {
    const q = vendorQuery.trim().toLowerCase();
    return q === "" ? vendors : vendors.filter((v) => v.toLowerCase().includes(q));
  }, [vendors, vendorQuery]);
  // 已勾但不在当前用途组清单里的厂商(切页签的残留):显形可取消,不静默消失
  const staleSelected = selectedVendors.filter((v) => !vendors.includes(v));

  const showContext = cat === "text" || cat === "all";
  const active =
    selectedVendors.length > 0 ||
    band !== "all" ||
    freeScope !== "all" ||
    protocols.length > 0 ||
    (showContext && contextBand !== "all") ||
    sourceKind !== "";

  return (
    <aside
      aria-label="模型筛选"
      className="flex flex-col divide-y divide-line/60 border-b border-line lg:border-b-0 lg:border-r"
    >
      {/* 头:计数 + 重置 */}
      <div className="flex items-center justify-between px-3.5 py-3">
        <span className="text-[11px] text-text-3">
          显示 <span className="font-mono text-text-1">{shown}</span> / {total}
        </span>
        {active && (
          <button
            type="button"
            onClick={() => {
              onVendorsChange([]);
              onBandChange("all");
              onContextBandChange("all");
              onSourceKindChange("");
              onProtocolsChange([]);
              if (freeScope !== "all") onFreeScopeChange("all");
            }}
            className="cursor-pointer text-[11px] text-accent hover:text-accent-hover"
          >
            重置
          </button>
        )}
      </div>

      <Group title="用途(模型类型)">
        <RadioChips options={MODEL_CAT_OPTIONS} value={cat} onChange={onCatChange} />
      </Group>

      <Group title="厂商">
        {vendors.length > 10 && (
          <input
            value={vendorQuery}
            onChange={(e) => setVendorQuery(e.target.value)}
            placeholder="搜索厂商…"
            className="mb-2 w-full rounded-sm border border-line bg-panel-2 px-2 py-1 text-[11.5px] outline-none focus:border-accent"
          />
        )}
        <div className="max-h-64 overflow-y-auto pr-1">
          <label className="mb-1.5 flex cursor-pointer items-center gap-1.5 text-[11.5px] text-text-2">
            <input
              type="checkbox"
              className="accent-accent"
              checked={selectedVendors.length === 0}
              onChange={() => onVendorsChange([])}
            />
            全部厂商
          </label>
          {shownVendors.map((v) => {
            const on = selectedVendors.includes(v);
            return (
              <label
                key={v}
                className="mb-1.5 flex cursor-pointer items-center gap-1.5 text-[11.5px] leading-snug"
              >
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={on}
                  onChange={() =>
                    onVendorsChange(
                      on ? selectedVendors.filter((s) => s !== v) : [...selectedVendors, v],
                    )
                  }
                />
                <span className={on ? "text-text-1" : "text-text-2"}>{v}</span>
              </label>
            );
          })}
          {shownVendors.length === 0 && (
            <p className="text-[11px] text-text-3">无匹配厂商,换个词</p>
          )}
          {staleSelected.length > 0 && (
            <div className="mt-2 border-t border-line/60 pt-2">
              <p className="mb-1.5 text-[10.5px] text-amber">
                已勾选,但当前用途组无模型(切换「用途」可见)
              </p>
              {staleSelected.map((v) => (
                <label
                  key={v}
                  className="mb-1.5 flex cursor-pointer items-center gap-1.5 text-[11.5px] leading-snug"
                >
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked
                    onChange={() => onVendorsChange(selectedVendors.filter((s) => s !== v))}
                  />
                  <span className="text-text-2">{v}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </Group>

      <Group title="价格">
        <p className="mb-1.5 text-[10.5px] text-text-3">{priceLabel}</p>
        <RadioChips options={PRICE_BANDS} value={band} onChange={onBandChange} />
      </Group>

      {showContext && (
        <Group title="上下文长度">
          <RadioChips options={CONTEXT_BANDS} value={contextBand} onChange={onContextBandChange} />
        </Group>
      )}

      <Group title="来源类型">
        <RadioChips
          options={SOURCE_KIND_OPTIONS}
          value={sourceKind}
          onChange={onSourceKindChange}
        />
      </Group>

      <Group title="协议">
        <div className="flex flex-col gap-1.5">
          {PROTOCOL_OPTIONS.map((o) => {
            const on = protocols.includes(o.id);
            return (
              <label
                key={o.id}
                className="flex cursor-pointer items-center gap-1.5 text-[11.5px] leading-snug"
              >
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={on}
                  onChange={() =>
                    onProtocolsChange(
                      on ? protocols.filter((p) => p !== o.id) : [...protocols, o.id],
                    )
                  }
                />
                <span className={on ? "text-text-1" : "text-text-2"}>{o.label}</span>
              </label>
            );
          })}
        </div>
      </Group>

      <Group title="优惠与排序">
        {/* 免费口径单选四态(2026-11-18 反馈:「筛选免费额度中有明确额度的」
            没有好办法——老开关只认完全免费,而「有免费额度」的行占多数):
            完全免费(is_free)/ 有免费额度(free_tier 原文非空)/ 任一免费(并集) */}
        <RadioChips
          options={FREE_SCOPE_OPTIONS.map((o) => ({
            id: o.id,
            label: o.id === "all" ? o.label : `${o.label} ${freeCounts[o.id]}`,
          }))}
          value={freeScope}
          onChange={onFreeScopeChange}
        />
        <div className="mt-2.5">
          <RadioChips options={MODEL_SORT_OPTIONS} value={sort} onChange={onSortChange} />
        </div>
      </Group>

      {shown === 0 && (
        <p className="px-3.5 py-3 text-[11px] text-amber">
          当前筛选无匹配 —— 试试切换「用途」分组或放宽条件
        </p>
      )}
    </aside>
  );
}
