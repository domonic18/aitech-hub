/**
 * 整表数据截至横幅(验收问题一改造时保留原 D5 语义):超 45 天转琥珀提醒;
 * 空表不出具体日期。纯展示,无状态。
 */
import { isPricingStale, PRICING_STALE_DAYS, type PublicPricing } from "@/lib/pricing/public";

import { asOfDate } from "./shared";

export function StatusBanner({ data }: { data: PublicPricing }): React.ReactElement {
  const overall = [data.modelsAsOf, data.plansAsOf]
    .filter((s): s is string => s !== null)
    .sort()
    .at(-1);
  const stale =
    isPricingStale(data.modelsAsOf === null ? null : asOfDate(data.modelsAsOf), new Date()) ||
    isPricingStale(data.plansAsOf === null ? null : asOfDate(data.plansAsOf), new Date());
  return (
    <div
      className={`rounded-lg border px-4 py-2.5 text-[12.5px] leading-relaxed ${
        stale ? "border-amber/30 bg-amber/8 text-amber" : "border-line bg-panel text-text-2"
      }`}
    >
      <i className={`mr-2 inline-block h-2 w-2 rounded-full ${stale ? "bg-amber" : "bg-green"}`} />
      {overall === null ? (
        <span>牌价上架中,先看看</span>
      ) : stale ? (
        <span>
          数据截至 {overall} · 已超 {PRICING_STALE_DAYS} 天未核对,价格可能过期 ·
          <span className="text-amber"> 请以官方页面为准</span>
        </span>
      ) : (
        <span>
          数据截至 {overall} ·
          <span className="text-green">
            API 牌价 + Coding Plan 双维度 · 每月人工核对更新 · 以官方页面为准
          </span>
        </span>
      )}
    </div>
  );
}
