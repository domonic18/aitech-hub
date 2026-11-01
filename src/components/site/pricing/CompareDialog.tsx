"use client";

/**
 * 套餐横向对比弹窗(验收问题三):最多 4 列并排,逐行同口径对齐——月费/周期
 * 价/额度口径/时段扣费/适合/权益/数据截至/来源。货币不做汇率折算(D4 延伸),
 * 跨币种对比时显式提示。portal 到 body + Escape 关闭 + 打开即聚焦关闭键。
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { formatPrice, type PublicPlanRow } from "@/lib/pricing/public";

import { planKey } from "./shared";

const ROWS: Array<{ label: string; render: (r: PublicPlanRow) => React.ReactNode }> = [
  { label: "厂商", render: (r) => r.vendor },
  { label: "月费", render: (r) => formatPrice(r.monthlyFee, r.currency) },
  {
    label: "季付(折合月)",
    render: (r) => (r.quarterlyFee === null ? "—" : `¥ ${r.quarterlyFee}`),
  },
  { label: "年付", render: (r) => (r.yearlyFee === null ? "—" : `¥ ${r.yearlyFee}`) },
  // 年付口径各家不一(Kimi=周期总价 / GLM·小米=折合月),D3 不归一就必须在此抄原文,
  // 否则并排看会误读——比价场景下这条不是附注而是主体
  {
    label: "计费口径",
    render: (r) =>
      r.billingNote === null ? (
        <span className="text-text-3">—</span>
      ) : (
        <span className="text-[11.5px] leading-relaxed text-text-3">{r.billingNote}</span>
      ),
  },
  { label: "额度口径", render: (r) => r.quotaDesc },
  {
    label: "时段扣费",
    render: (r) => [r.peakRate, r.offPeakRate].filter(Boolean).join(" · ") || "—",
  },
  { label: "适合", render: (r) => r.bestFor ?? "—" },
  {
    label: "权益",
    render: (r) =>
      r.benefits === null || r.benefits.length === 0 ? (
        "—"
      ) : (
        <ul className="flex list-disc flex-col gap-1 pl-4">
          {r.benefits.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ),
  },
  { label: "数据截至", render: (r) => r.dataAsOf },
  {
    label: "来源",
    render: (r) => (
      <a
        href={r.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue hover:text-blue/80"
      >
        官方页↗
      </a>
    ),
  },
];

export interface CompareDialogProps {
  plans: PublicPlanRow[];
  onClose: () => void;
}

export function CompareDialog({ plans, onClose }: CompareDialogProps): React.ReactElement {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // 最低月费角标:比价时最直观的一眼(全项同价时不出——那时人人"最低",是噪音)
  const fees = plans.map((p) => p.monthlyFee).filter((f): f is number => f !== null);
  const minFee = fees.length >= 2 && new Set(fees).size > 1 ? Math.min(...fees) : null;
  const mixedCurrency = new Set(plans.map((p) => p.currency)).size > 1;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pricing-compare-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-line bg-bg shadow-lg">
        <div className="flex items-center gap-3 border-b border-line bg-panel px-4 py-3">
          <h3 id="pricing-compare-title" className="text-[14px] font-semibold text-text-1">
            套餐对比 · {plans.length} 项
          </h3>
          <p className="text-[11px] text-text-3 sm:hidden">左右滑动对比</p>
          <p className="hidden text-[11px] text-text-3 sm:block">
            同色行为同一口径,额度与权益均按官方原文
          </p>
          <button
            ref={closeRef}
            type="button"
            className="ml-auto cursor-pointer rounded-md border border-line px-2.5 py-1 text-[12px] text-text-2 hover:border-line-hover hover:text-text-1"
            onClick={onClose}
          >
            关闭
          </button>
        </div>

        <div className="overflow-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-panel-2/50">
                <th className="sticky left-0 z-10 w-24 bg-panel-2 px-3 py-3 text-[11px] font-normal text-text-3">
                  对比项
                </th>
                {plans.map((p) => {
                  const lowest = minFee !== null && p.monthlyFee === minFee;
                  return (
                    <th
                      key={planKey(p)}
                      scope="col"
                      className="min-w-[150px] px-3 py-3 align-bottom"
                    >
                      <div className="text-[13px] font-semibold text-text-1">{p.planName}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[12px] font-normal text-text-2">
                        {formatPrice(p.monthlyFee, p.currency)}
                        {lowest && (
                          <span className="rounded-sm bg-accent-dim px-1 py-px text-[10px] text-accent-hi">
                            月费最低
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.label} className="border-b border-line/50 last:border-0">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-bg px-3 py-3 align-top text-[11px] font-normal text-text-3"
                  >
                    {row.label}
                  </th>
                  {plans.map((p) => (
                    <td key={planKey(p)} className="px-3 py-3 align-top text-text-2">
                      {row.render(p)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="border-t border-line bg-panel px-4 py-2.5 text-[11px] text-text-3">
          {mixedCurrency
            ? "所选套餐币种不同,金额按各自原币呈现、未做汇率折算,勿直接比数值。"
            : "金额为官方原币口径未折算;年付各家口径不一(周期总价 / 折合月),以「计费口径」行原文为准。"}
        </p>
      </div>
    </div>,
    document.body,
  );
}
