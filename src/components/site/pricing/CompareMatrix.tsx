"use client";

/**
 * 牌价比价视图(M74 批D):同一模型跨提供商并排比价,最低价标出。
 *
 * 形态是「分组行」而非固定列矩阵——各模型被哪些提供商供价并不相同
 * (有的只有 3 家、有的 5 家),固定列矩阵会满屏空格;分组行里组内按价格升序,
 * **第一家就是最低价**(标「最低」)。
 *
 * 币种分区:现口径是原币直出不折算(D4),跨币种比大小是假的 → 按币种分区,
 * 区内才比;某模型跨币种报价则不标「最低」并注明。
 */
import type { CompareCell, CompareGroup } from "@/lib/pricing/compare";
import { COMPARE_MAX_MODELS_PER_GROUP } from "@/lib/pricing/compare";
import { MODALITY_LABELS } from "@/lib/pricing/modality";
import { protocolsLabel } from "@/lib/pricing/protocols";
import { formatPrice, UNIT_SUFFIXES } from "@/lib/pricing/public";

/** 价格格(原币直出;非 token 单位带中文后缀) */
function priceText(v: number | null, currency: string, unit: string): string {
  return formatPrice(v, currency, unit);
}

/** 档位明细(阶梯/缓存/峰谷/模态) */
function TierList({ cell }: { cell: CompareCell }): React.ReactElement {
  if (cell.tiers.length === 0) {
    return <p className="text-[11px] text-text-3">该行无额外档位(单价即基准价)</p>;
  }
  return (
    <ul className="flex flex-col gap-1 text-[11px] text-text-3">
      {cell.tiers.map((t) => (
        <li key={t.tierLabel} className="font-mono">
          <span className="text-text-2">{t.tierLabel}</span>
          {t.inputPrice !== null && <span> · 输入 {t.inputPrice}</span>}
          {t.outputPrice !== null && <span> · 输出 {t.outputPrice}</span>}
          {t.cachePrice !== null && <span> · 缓存 {t.cachePrice}</span>}
          {t.minTokens !== null && (
            <span>
              {" "}
              · {t.minTokens}
              {t.maxTokens !== null ? `–${t.maxTokens}` : ""} tokens
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** 一个提供商的报价卡 */
function Cell({
  cell,
  isCheapest,
}: {
  cell: CompareCell;
  isCheapest: boolean;
}): React.ReactElement {
  return (
    <div
      className={`min-w-[168px] flex-1 rounded-md border px-3 py-2 ${
        isCheapest ? "border-green/50 bg-green/5" : "border-line bg-panel-2/40"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[12px] font-medium text-text-1">{cell.providerName}</span>
        {isCheapest && (
          <span className="shrink-0 rounded border border-green/50 px-1.5 text-[10px] leading-none text-green-hi">
            最低
          </span>
        )}
        {cell.isFree && (
          <span className="shrink-0 rounded border border-green/40 px-1.5 text-[10px] leading-none text-green-hi">
            免费
          </span>
        )}
      </div>
      <div className="mt-1 font-mono text-[12px] text-text-1">
        输入 {priceText(cell.inputPrice, cell.currency, cell.priceUnit)}
      </div>
      <div className="font-mono text-[12px] text-text-1">
        输出 {priceText(cell.outputPrice, cell.currency, cell.priceUnit)}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10.5px] text-text-3">
        <a
          href={cell.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue hover:text-blue/80"
        >
          官方↗
        </a>
        {cell.protocols.length > 0 && <span>{protocolsLabel(cell.protocols)}</span>}
        <span>截至 {cell.dataAsOf}</span>
      </div>
      {cell.tiers.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer select-none text-[10.5px] text-text-3 hover:text-text-2">
            {cell.tiers.length} 个价格档位
          </summary>
          <div className="mt-1">
            <TierList cell={cell} />
          </div>
        </details>
      )}
    </div>
  );
}

/** 一个模型的比价行 */
function ModelCompareRow({ model }: { model: CompareGroup["models"][number] }): React.ReactElement {
  return (
    <div className="border-b border-line/60 px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-[13px] font-semibold text-text-1">{model.displayName}</span>
        {model.modality !== null && model.modality !== "text" && (
          <span className="rounded border border-line px-1.5 text-[10px] leading-none text-text-3">
            {(MODALITY_LABELS as Record<string, string>)[model.modality] ?? model.modality}
          </span>
        )}
        <span className="text-[11px] text-text-3">{model.providerCount} 家报价</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {model.cells.map((cell) => (
          <Cell
            key={cell.providerKey}
            cell={cell}
            isCheapest={cell.providerKey === model.cheapestProviderKey}
          />
        ))}
      </div>
    </div>
  );
}

export interface CompareMatrixProps {
  groups: CompareGroup[];
}

export function CompareMatrix({ groups }: CompareMatrixProps): React.ReactElement {
  if (groups.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[12px] text-text-3">
        当前筛选下没有「同一模型 ≥2 家报价」的可比价模型——换个筛选条件试试
      </p>
    );
  }
  return (
    <div>
      {groups.map((group) => (
        <div
          key={`${group.currency}|${group.priceUnit}`}
          className="border-b border-line last:border-b-0"
        >
          <div className="flex items-center gap-2 border-b border-line bg-panel-2/50 px-4 py-2.5">
            <h3 className="text-[12px] font-semibold text-text-1">
              {group.currency === "USD" ? "美元 $" : "人民币 ¥"} ·{" "}
              {group.priceUnit === "per_1m_tokens"
                ? "每百万 tokens"
                : group.priceUnit === "per_1k_tokens"
                  ? "每千 tokens"
                  : (UNIT_SUFFIXES[group.priceUnit] ?? group.priceUnit)}
            </h3>
            <span className="ml-auto font-mono text-[11px] text-blue">
              {group.models.length} 个模型
            </span>
          </div>
          {group.models.map((model) => (
            <ModelCompareRow key={model.key} model={model} />
          ))}
          {group.truncated > 0 && (
            <p className="px-4 py-2.5 text-[11px] text-text-3">
              本区还有 {group.truncated} 个更贵的模型未展示(每区最多 {COMPARE_MAX_MODELS_PER_GROUP}{" "}
              个),缩小筛选可见全量。
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
