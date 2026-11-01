"use client";

/**
 * Coding Plan 订阅套餐面板(验收问题一筛选 + 问题三比价勾选):额度口径
 * 原文直出(D3),峰谷倍率琥珀;周期价直显(比价要看年/季,不必展开)。
 * 「按价格排序」让同价位套餐相邻(验收问题三的用户动线),勾选行进对比托盘。
 */
import {
  filterPricingRows,
  formatPrice,
  vendorOptions,
  type PriceBandId,
  type PublicPlanRow,
} from "@/lib/pricing/public";

import { FilterBar } from "./FilterBar";
import { planKey } from "./shared";

const peakText = (r: PublicPlanRow): string =>
  [r.peakRate, r.offPeakRate].filter(Boolean).join(" · ");

/** 周期价直显行(比价所需季/年不必展开;口径原文 title) */
function PlanCycleLines({ r }: { r: PublicPlanRow }): React.ReactElement | null {
  if (r.quarterlyFee === null && r.yearlyFee === null) return null;
  return (
    <div
      className="mt-1 font-mono text-[10.5px] leading-relaxed text-text-3"
      title={r.billingNote ?? undefined}
    >
      {r.quarterlyFee !== null && <div>季付 ¥ {r.quarterlyFee}/月</div>}
      {r.yearlyFee !== null && <div>年付 ¥ {r.yearlyFee}</div>}
    </div>
  );
}

/** 权益详情+来源(details 展开收起,零 JS;周期价已直显不在此) */
function PlanBenefitsDetails({ r }: { r: PublicPlanRow }): React.ReactElement | null {
  if (r.benefits === null || r.benefits.length === 0) return null;
  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer select-none text-[11px] text-accent hover:text-accent-hover">
        权益详情
      </summary>
      <div className="mt-1.5 flex flex-col gap-1 text-[11.5px] leading-relaxed text-text-2">
        {r.billingNote !== null && <div className="text-text-3">{r.billingNote}</div>}
        <ul className="mt-0.5 flex list-disc flex-col gap-0.5 pl-4">
          {r.benefits.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <div>
          来源:
          <a
            href={r.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue hover:text-blue/80"
          >
            官方页↗
          </a>
        </div>
      </div>
    </details>
  );
}

/** 勾选框(对比选择器):满 4 项时未选中的行禁用并给 title 说明。
 *  外层 label 用负边距+等量内边距撑到 ~30px 触控区(移动端 14px 方框点不中),
 *  视觉位置不变;title 挂 label 上,禁用态的 input 不派发 hover 事件。 */
function CompareCheck({
  checked,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <label
      className="-m-2 flex cursor-pointer items-center p-2"
      title={disabled ? "对比最多 4 个,先移除已选项" : "加入对比"}
    >
      <input
        type="checkbox"
        className="h-4 w-4 cursor-pointer accent-accent disabled:cursor-not-allowed"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        aria-label={`把 ${label} 加入对比`}
      />
    </label>
  );
}

export interface PlanSectionProps {
  plans: PublicPlanRow[];
  selectedVendors: string[];
  onVendorsChange: (v: string[]) => void;
  band: PriceBandId;
  onBandChange: (b: PriceBandId) => void;
  sortByPrice: boolean;
  onToggleSort: () => void;
  compareKeys: string[];
  onToggleCompare: (key: string) => void;
  compareLimit: number;
}

export function PlanSection({
  plans,
  selectedVendors,
  onVendorsChange,
  band,
  onBandChange,
  sortByPrice,
  onToggleSort,
  compareKeys,
  onToggleCompare,
  compareLimit,
}: PlanSectionProps): React.ReactElement {
  const filtered = filterPricingRows(plans, {
    vendors: selectedVendors,
    band,
    vendorOf: (r) => r.vendor,
    priceOf: (r) => r.monthlyFee,
  });
  const rows = sortByPrice
    ? [...filtered].sort((a, b) => {
        // 未公布价沉底(不比 null);同价并列时按厂商稳定,便于横向比权益
        if (a.monthlyFee === null && b.monthlyFee === null) return 0;
        if (a.monthlyFee === null) return 1;
        if (b.monthlyFee === null) return -1;
        return a.monthlyFee - b.monthlyFee;
      })
    : filtered;
  const full = compareKeys.length >= compareLimit;

  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-line bg-panel shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 bg-panel-2/50 px-4 py-3">
        <h2 className="text-[13px] font-semibold text-text-1">Coding Plan 订阅套餐</h2>
        <p className="text-[11px] text-text-3">
          额度与周期价口径各家不一,按官方原文呈现(年付有「折合月」与「周期总价」两种); 时段扣费 =
          额度在高峰/闲时的计费倍率 · 勾选可横向比价
        </p>
      </div>
      <FilterBar
        vendors={vendorOptions(plans, (r) => r.vendor)}
        selectedVendors={selectedVendors}
        onVendorsChange={onVendorsChange}
        band={band}
        onBandChange={onBandChange}
        priceLabel="月费 · 原币"
        total={plans.length}
        shown={rows.length}
        sortByPrice={{ on: sortByPrice, onToggle: onToggleSort }}
      />

      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-[12.5px] text-text-3">
          当前筛选没有匹配的套餐(筛选提示见上方「重置筛选」)
        </p>
      ) : (
        <>
          <div className="hidden sm:block">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] font-normal text-text-3">
                  <th className="w-14 whitespace-nowrap px-4 py-2.5 font-normal">比价</th>
                  <th className="px-3 py-2.5 font-normal">厂商 · 套餐</th>
                  <th className="px-3 py-2.5 font-normal">月费</th>
                  <th className="px-3 py-2.5 font-normal">额度口径</th>
                  <th className="px-3 py-2.5 font-normal">时段扣费</th>
                  <th className="px-4 py-2.5 font-normal">适合</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const key = planKey(r);
                  const checked = compareKeys.includes(key);
                  return (
                    <tr key={key} className="border-b border-line/50 last:border-0">
                      <td className="px-4 py-3.5 align-top">
                        <CompareCheck
                          checked={checked}
                          disabled={full && !checked}
                          label={r.planName}
                          onToggle={() => onToggleCompare(key)}
                        />
                      </td>
                      <td className="px-3 py-3.5 align-top">
                        <div className="text-[13px] font-semibold text-text-1">{r.planName}</div>
                        <div className="mt-0.5 text-[11px] text-text-3">{r.vendor}</div>
                        <PlanBenefitsDetails r={r} />
                      </td>
                      <td className="px-3 py-3.5 align-top font-mono text-text-1">
                        {formatPrice(r.monthlyFee, r.currency)}
                        <PlanCycleLines r={r} />
                      </td>
                      <td className="px-3 py-3.5 align-top text-[12.5px] text-text-2">
                        {r.quotaDesc}
                      </td>
                      <td className="px-3 py-3.5 align-top font-mono text-[12px] text-amber">
                        {peakText(r) === "" ? <span className="text-text-3">—</span> : peakText(r)}
                      </td>
                      <td className="px-4 py-3.5 align-top text-[12.5px] text-text-2">
                        {r.bestFor ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 p-3 sm:hidden">
            {rows.map((r) => {
              const key = planKey(r);
              const checked = compareKeys.includes(key);
              return (
                <div key={key} className="rounded-lg border border-line/70 px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[13px] font-semibold text-text-1">{r.planName}</div>
                      <div className="mt-0.5 text-[11px] text-text-3">{r.vendor}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-[13px] text-text-1">
                        {formatPrice(r.monthlyFee, r.currency)}/月
                      </span>
                      <CompareCheck
                        checked={checked}
                        disabled={full && !checked}
                        label={r.planName}
                        onToggle={() => onToggleCompare(key)}
                      />
                    </div>
                  </div>
                  <div className="mt-2 text-[12.5px] text-text-2">额度:{r.quotaDesc}</div>
                  <PlanCycleLines r={r} />
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                    {peakText(r) !== "" && (
                      <span className="font-mono text-amber">{peakText(r)}</span>
                    )}
                    {r.bestFor !== null && <span className="text-text-3">适合:{r.bestFor}</span>}
                  </div>
                  <PlanBenefitsDetails r={r} />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
