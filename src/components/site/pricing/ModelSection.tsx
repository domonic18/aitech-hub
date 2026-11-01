"use client";

/**
 * 模型牌价面板(验收问题一:厂商 × 输入价区间筛选):按 国内/国际 分组
 * (组头币种口径+计数徽章,USD 原币直出 D4);移动端表格降维卡片(P2 口径,
 * 纯 CSS)。筛选在客户端做,全量行仍随 SSR 进 HTML(SEO 生命线不破)。
 */
import {
  filterPricingRows,
  formatPrice,
  sortPublicModels,
  vendorOptions,
  type PriceBandId,
  type PublicModelRow,
} from "@/lib/pricing/public";

import { FilterBar } from "./FilterBar";
import { OfficialLink, groupKey, groupTitle } from "./shared";

function ModelTable({ rows }: { rows: PublicModelRow[] }): React.ReactElement {
  return (
    <div className="hidden sm:block">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line text-[11px] font-normal text-text-3">
            <th className="px-4 py-2.5 font-normal">模型 / 厂商</th>
            <th className="px-3 py-2.5 font-normal">输入价</th>
            <th className="px-3 py-2.5 font-normal">输出价</th>
            <th className="px-3 py-2.5 font-normal">免费额度</th>
            <th className="px-3 py-2.5 font-normal">上下文</th>
            <th className="px-3 py-2.5 font-normal">数据截至</th>
            <th className="px-4 py-2.5 text-right font-normal">来源</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.vendor}|${r.modelKey}`} className="border-b border-line/50 last:border-0">
              <td className="px-4 py-3.5">
                <div className="font-mono text-[13px] font-semibold text-text-1">{r.modelKey}</div>
                <div className="mt-0.5 text-[11px] text-text-3">{r.vendor}</div>
              </td>
              <td className="px-3 py-3.5 font-mono text-text-1">
                {formatPrice(r.inputPrice, r.currency)}
              </td>
              <td className="px-3 py-3.5 font-mono text-text-1">
                {formatPrice(r.outputPrice, r.currency)}
              </td>
              <td className="px-3 py-3.5 text-[12px]">
                {r.freeTier === null ? (
                  <span className="text-text-3">—</span>
                ) : (
                  <span className="text-amber">{r.freeTier}</span>
                )}
              </td>
              <td className="px-3 py-3.5 font-mono text-[12px] text-text-3">
                {r.contextWindow ?? "—"}
              </td>
              <td className="px-3 py-3.5 font-mono text-[12px] text-text-3">
                {r.dataAsOf.slice(5)}
              </td>
              <td className="px-4 py-3.5 text-right">
                <OfficialLink url={r.sourceUrl} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelCards({ rows }: { rows: PublicModelRow[] }): React.ReactElement {
  return (
    <div className="flex flex-col gap-3 p-3 sm:hidden">
      {rows.map((r) => (
        <div
          key={`${r.vendor}|${r.modelKey}`}
          className="rounded-lg border border-line/70 px-4 py-3"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[13px] font-semibold text-text-1">{r.modelKey}</span>
            <OfficialLink url={r.sourceUrl} />
          </div>
          <div className="mt-0.5 text-[11px] text-text-3">{r.vendor}</div>
          <div className="mt-2 flex gap-5 font-mono text-[13px] text-text-1">
            <span>
              <span className="mr-1 text-[10.5px] font-normal text-text-3">输入</span>
              {formatPrice(r.inputPrice, r.currency)}
            </span>
            <span>
              <span className="mr-1 text-[10.5px] font-normal text-text-3">输出</span>
              {formatPrice(r.outputPrice, r.currency)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-3">
            {r.freeTier !== null && <span className="text-amber">免费额度:{r.freeTier}</span>}
            {r.contextWindow !== null && <span>上下文 {r.contextWindow}</span>}
            <span>截至 {r.dataAsOf}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export interface ModelSectionProps {
  models: PublicModelRow[];
  selectedVendors: string[];
  onVendorsChange: (v: string[]) => void;
  band: PriceBandId;
  onBandChange: (b: PriceBandId) => void;
}

export function ModelSection({
  models,
  selectedVendors,
  onVendorsChange,
  band,
  onBandChange,
}: ModelSectionProps): React.ReactElement {
  const rows = filterPricingRows(sortPublicModels(models), {
    vendors: selectedVendors,
    band,
    vendorOf: (r) => r.vendor,
    priceOf: (r) => r.inputPrice,
  });
  const groups = [...new Set(rows.map(groupKey))];
  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-line bg-panel shadow-sm">
      <FilterBar
        vendors={vendorOptions(models, (r) => r.vendor)}
        selectedVendors={selectedVendors}
        onVendorsChange={onVendorsChange}
        band={band}
        onBandChange={onBandChange}
        priceLabel="输入价 · 每百万 tokens(原币)"
        total={models.length}
        shown={rows.length}
      />
      {groups.map((key) => {
        const groupRows = rows.filter((m) => groupKey(m) === key);
        return (
          <div key={key} className="border-b border-line last:border-b-0">
            <div className="flex items-center gap-2 border-b border-line bg-panel-2/50 px-4 py-3">
              <h2 className="text-[13px] font-semibold text-text-1">
                {groupTitle(key, groupRows)}
              </h2>
              <span className="ml-auto font-mono text-[11px] text-blue">{groupRows.length}</span>
            </div>
            <ModelTable rows={groupRows} />
            <ModelCards rows={groupRows} />
          </div>
        );
      })}
      {rows.length > 0 && (
        <p className="border-t border-line px-4 py-3 text-[11.5px] text-text-3">
          共 {rows.length} 个模型 · v1 覆盖 {new Set(rows.map((m) => m.vendor)).size} 家官方厂牌 ·
          完整列表随官方调价滚动更新
        </p>
      )}
    </div>
  );
}
