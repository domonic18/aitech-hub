/**
 * 模型对比矩阵(UX P3):用户勾选 ≤4 个模型 → 并排对比。
 * 纯函数、零库依赖(可进 client chunk)。
 *
 * 扩展点:新能力 = MODEL_COMPARE_ROWS 数组加一项 {label, render}。
 */
import { formatPrice, type PublicModelRow } from "./public";
import { protocolsLabel } from "./protocols";
import { rowResolution } from "./resolution";

export const MODEL_COMPARE_LIMIT = 4;

/** 对比矩阵一行(对齐行 × 模型列) */
export interface CompareRowDef {
  label: string;
  render: (row: PublicModelRow) => string;
}

/** 对比矩阵行定义(初始集;新能力在此追加) */
export const MODEL_COMPARE_ROWS: ReadonlyArray<CompareRowDef> = [
  { label: "模型名", render: (r) => r.modelDisplayName ?? r.modelKey },
  { label: "厂商", render: (r) => r.providerName ?? r.vendor },
  {
    label: "来源类型",
    render: (r) =>
      r.providerKind === "official"
        ? "官方一手价"
        : r.providerKind === "aggregator"
          ? "聚合平台价"
          : "—",
  },
  { label: "输入价", render: (r) => formatPrice(r.inputPrice, r.currency) },
  {
    label: "输出价",
    render: (r) =>
      r.outputPrice === null ? "未公布" : `${formatPrice(r.outputPrice, r.currency, r.priceUnit)}`,
  },
  {
    label: "计价单位",
    render: (r) =>
      r.priceUnit === "per_1m_tokens"
        ? "元/百万 tokens"
        : r.priceUnit === "per_image"
          ? "元/张"
          : r.priceUnit === "per_second"
            ? "元/秒"
            : r.priceUnit === "per_minute"
              ? "元/分钟"
              : r.priceUnit,
  },
  { label: "上下文", render: (r) => r.contextWindow ?? "—" },
  { label: "完全免费", render: (r) => (r.isFree ? "是" : "否") },
  { label: "免费额度", render: (r) => r.freeTier ?? "—" },
  { label: "协议", render: (r) => (r.protocols.length > 0 ? protocolsLabel(r.protocols) : "—") },
  { label: "推荐分辨率", render: (r) => rowResolution(r) ?? "—" },
  { label: "数据截至", render: (r) => r.dataAsOf },
];

/** 构建对比矩阵:行 × 模型列 */
export function buildCompareMatrix(
  rows: PublicModelRow[],
): Array<{ label: string; cells: string[] }> {
  return MODEL_COMPARE_ROWS.map((def) => ({
    label: def.label,
    cells: rows.map((r) => def.render(r)),
  }));
}
