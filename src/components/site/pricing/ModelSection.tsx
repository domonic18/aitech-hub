"use client";

/**
 * 模型牌价面板(验收问题一:厂商 × 输入价区间筛选;M74 批C:免费标识 + 多维筛选
 * + 排序):按 国内/国际 分组(组头币种口径+计数徽章,USD 原币直出 D4);移动端表格
 * 降维卡片(P2 口径,纯 CSS)。筛选在客户端做,全量行仍随 SSR 进 HTML(SEO 生命线不破)。
 *
 * 免费有两个语义,展示上必须分开:
 * - **完全免费**(is_free):调用不花钱 → 行级绿色「免费」角标
 * - **有免费额度**(free_tier):如「每日 200 万 tokens 免费」→ 橙色额度原文(不叫免费)
 */
import {
  filterModelRows,
  formatPrice,
  sortPublicModels,
  sortModelRows,
  vendorOptions,
  type ContextBandId,
  type ModelSortId,
  type PriceBandId,
  type PublicModelRow,
} from "@/lib/pricing/public";

import { FilterBar } from "./FilterBar";
import { ModelFilters } from "./ModelFilters";
import { OfficialLink, groupKey, groupTitle } from "./shared";

/** 完全免费角标 */
function FreeBadge(): React.ReactElement {
  return (
    <span className="ml-1.5 rounded border border-green/40 bg-green/10 px-1.5 py-0.5 align-middle text-[10.5px] leading-none text-green-hi">
      免费
    </span>
  );
}

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
                <div className="font-mono text-[13px] font-semibold text-text-1">
                  {r.modelKey}
                  {r.isFree && <FreeBadge />}
                </div>
                <div className="mt-0.5 text-[11px] text-text-3">
                  {r.providerName ?? r.vendor}
                  {r.providerKind === "aggregator" && (
                    <span className="ml-1 text-amber">聚合挂牌</span>
                  )}
                </div>
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
            <span className="font-mono text-[13px] font-semibold text-text-1">
              {r.modelKey}
              {r.isFree && <FreeBadge />}
            </span>
            <OfficialLink url={r.sourceUrl} />
          </div>
          <div className="mt-0.5 text-[11px] text-text-3">
            {r.providerName ?? r.vendor}
            {r.providerKind === "aggregator" && <span className="ml-1 text-amber">聚合挂牌</span>}
          </div>
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
  freeOnly: boolean;
  onToggleFree: () => void;
  modality: string;
  onModalityChange: (v: string) => void;
  contextBand: ContextBandId;
  onContextBandChange: (v: ContextBandId) => void;
  sourceKind: string;
  onSourceKindChange: (v: string) => void;
  sort: ModelSortId;
  onSortChange: (v: ModelSortId) => void;
}

export function ModelSection({
  models,
  selectedVendors,
  onVendorsChange,
  band,
  onBandChange,
  freeOnly,
  onToggleFree,
  modality,
  onModalityChange,
  contextBand,
  onContextBandChange,
  sourceKind,
  onSourceKindChange,
  sort,
  onSortChange,
}: ModelSectionProps): React.ReactElement {
  const rows = sortModelRows(
    filterModelRows(sortPublicModels(models), {
      vendors: selectedVendors,
      band,
      freeOnly,
      modality,
      contextBand,
      sourceKind,
    }),
    sort,
  );
  const groups = [...new Set(rows.map(groupKey))];
  const freeCount = models.filter((m) => m.isFree).length;
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
        freeOnly={{ on: freeOnly, onToggle: onToggleFree, freeCount }}
        extra={
          <ModelFilters
            modality={modality}
            onModalityChange={onModalityChange}
            contextBand={contextBand}
            onContextBandChange={onContextBandChange}
            sourceKind={sourceKind}
            onSourceKindChange={onSourceKindChange}
            sort={sort}
            onSortChange={onSortChange}
          />
        }
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
