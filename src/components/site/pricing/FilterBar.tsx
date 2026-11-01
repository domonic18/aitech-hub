"use client";

/**
 * /pricing/ 筛选条(验收问题一):厂商多选 × 价格区间单选,按面板各持一份状态
 * ——模型按「输入价/百万 tokens」、套餐按「月费」计价,量纲不同不给共用一条
 * 区间(共用会把 ¥2/百万 tokens 与 ¥49/月 放进同一档,是谎话)。
 * 「全部」= 清空厂商选择;计数徽章显示「当前可见 / 全部」,无结果给重置出口。
 */
import { PRICE_BANDS, type PriceBandId } from "@/lib/pricing/public";

const chipBase =
  "rounded-full border px-2.5 py-1 text-[11.5px] leading-none transition-colors cursor-pointer select-none";
const chipOn = "border-accent bg-accent text-white";
const chipOff = "border-line bg-panel text-text-2 hover:border-line-hover hover:text-text-1";

export interface FilterBarProps {
  vendors: string[];
  selectedVendors: string[];
  onVendorsChange: (v: string[]) => void;
  band: PriceBandId;
  onBandChange: (b: PriceBandId) => void;
  /** 区间口径说明(月费 / 输入价·每百万 tokens),显示在「价格」标签后 */
  priceLabel: string;
  total: number;
  shown: number;
  /** 可选的「按价格排序」开关(套餐面板:让同价位相邻,便于比价) */
  sortByPrice?: { on: boolean; onToggle: () => void };
}

export function FilterBar({
  vendors,
  selectedVendors,
  onVendorsChange,
  band,
  onBandChange,
  priceLabel,
  total,
  shown,
  sortByPrice,
}: FilterBarProps): React.ReactElement {
  const allVendors = selectedVendors.length === 0;
  const active = band !== "all" || !allVendors;
  const reset = (): void => {
    onVendorsChange([]);
    onBandChange("all");
  };
  return (
    <div className="flex flex-col gap-2 border-b border-line bg-panel-2/30 px-4 py-3 text-[11.5px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="w-8 shrink-0 text-text-3">厂商</span>
        <button
          type="button"
          aria-pressed={allVendors}
          className={`${chipBase} ${allVendors ? chipOn : chipOff}`}
          onClick={() => onVendorsChange([])}
        >
          全部
        </button>
        {vendors.map((v) => {
          const on = selectedVendors.includes(v);
          return (
            <button
              key={v}
              type="button"
              aria-pressed={on}
              className={`${chipBase} ${on ? chipOn : chipOff}`}
              onClick={() =>
                onVendorsChange(
                  on ? selectedVendors.filter((s) => s !== v) : [...selectedVendors, v],
                )
              }
            >
              {v}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="w-8 shrink-0 text-text-3">价格</span>
        <span className="text-[10.5px] text-text-3">{priceLabel}</span>
        {PRICE_BANDS.map((b) => (
          <button
            key={b.id}
            type="button"
            aria-pressed={band === b.id}
            className={`${chipBase} font-mono ${band === b.id ? chipOn : chipOff}`}
            onClick={() => onBandChange(b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-text-3">
        <span>
          显示 <span className="font-mono text-text-2">{shown}</span> / {total}
        </span>
        {sortByPrice !== undefined && (
          <label className="flex cursor-pointer items-center gap-1 select-none">
            <input
              type="checkbox"
              className="accent-accent"
              checked={sortByPrice.on}
              onChange={sortByPrice.onToggle}
            />
            按价格排序
          </label>
        )}
        {active && (
          <button
            type="button"
            className="cursor-pointer text-accent hover:text-accent-hover"
            onClick={reset}
          >
            重置筛选
          </button>
        )}
        {shown === 0 && <span className="text-amber">当前筛选无匹配,试试放宽条件</span>}
      </div>
    </div>
  );
}
