/**
 * 牌价比价装配(M74 批D):同一模型跨提供商并排比价 + 散点数据。
 *
 * 纯函数(零库依赖零 env)——前台客户端组件直接引,同 public.ts 纪律。
 *
 * 两条口径:
 * - **比价只在同币种内成立**:现口径是「原币直出不折算」(D4),跨币种比大小
 *   是假的。故按**单元格**的币种分区(同一模型的 CNY 报价进 CNY 区、USD 进 USD 区),
 *   区内才比大小。
 * - **最低价高亮看输入价**:输入价相同时比输出价;未公布价(null)不参与比较
 *   (「未公布」不是「最便宜」)。
 */
import type { PublicModelRow, PublicTierRow } from "./public";

/** 一个模型在某提供商的报价 */
export interface CompareCell {
  providerKey: string;
  providerName: string;
  vendor: string;
  inputPrice: number | null;
  outputPrice: number | null;
  currency: string;
  sourceUrl: string;
  dataAsOf: string;
  isFree: boolean;
  tiers: PublicTierRow[];
}

/** 一个归一后的模型(跨提供商) */
export interface CompareModel {
  /** 归一键(modelDictKey,未归一则回退 modelKey) */
  key: string;
  displayName: string;
  family: string | null;
  modality: string | null;
  /** 归入的币种区 */
  currency: string;
  /** 各提供商报价(按输入价升序,null 最后) */
  cells: CompareCell[];
  /** 最低输入价的提供商 key(同币种内;无有效价则 null) */
  cheapestProviderKey: string | null;
  /** 报价家数 */
  providerCount: number;
}

/** 一个币种区 */
export interface CompareGroup {
  currency: string;
  models: CompareModel[];
  /** 本区出现的提供商(按首次出现序) */
  providerKeys: string[];
}

/** 行 → 单元格(取该行在指定提供商下的报价) */
function cellOf(row: PublicModelRow): CompareCell {
  return {
    providerKey: row.providerKey ?? row.vendor,
    providerName: row.providerName ?? row.vendor,
    vendor: row.vendor,
    inputPrice: row.inputPrice,
    outputPrice: row.outputPrice,
    currency: row.currency,
    sourceUrl: row.sourceUrl,
    dataAsOf: row.dataAsOf,
    isFree: row.isFree,
    tiers: row.tiers,
  };
}

/** 归一键:优先模型字典键(跨厂商同一模型聚一起),未归一则回退原始模型键 */
export function compareKeyOf(row: PublicModelRow): string {
  return row.modelDictKey ?? row.modelKey;
}

/** 最低价判定:输入价小者胜;输入价相同比输出价;null 不参与 */
function cheaper(a: CompareCell, b: CompareCell): boolean {
  if (a.inputPrice === null) return false;
  if (b.inputPrice === null) return true;
  if (a.inputPrice !== b.inputPrice) return a.inputPrice < b.inputPrice;
  if (a.outputPrice === null) return false;
  if (b.outputPrice === null) return true;
  return a.outputPrice < b.outputPrice;
}

/**
 * 比价装配:按归一键聚合模型 → 按币种分区 → 区内容纳 ≥2 家报价的模型。
 * 只有一家报价的模型没有比价意义(不进矩阵,但计数在 UI 上说明)。
 */
export function buildCompareGroups(rows: PublicModelRow[]): CompareGroup[] {
  const byModel = new Map<string, PublicModelRow[]>();
  for (const row of rows) {
    const key = compareKeyOf(row);
    const list = byModel.get(key);
    if (list === undefined) byModel.set(key, [row]);
    else list.push(row);
  }

  const groups = new Map<string, CompareGroup>();
  for (const [key, list] of byModel) {
    const cells = list.map(cellOf);
    // 同一提供商多行(同模型的档位行/快照)取输入价最低的一条为代表
    const byProvider = new Map<string, CompareCell>();
    for (const cell of cells) {
      const prev = byProvider.get(cell.providerKey);
      if (prev === undefined || cheaper(cell, prev)) byProvider.set(cell.providerKey, cell);
    }
    const unique = [...byProvider.values()];

    // 按**单元格**的币种拆:同一模型的 CNY 报价进 CNY 区、USD 报价进 USD 区
    // (按模型拆会让 USD 那格落在 CNY 区里,区头币种就成了假话)
    const byCurrency = new Map<string, CompareCell[]>();
    for (const cell of unique) {
      const bucket = byCurrency.get(cell.currency);
      if (bucket === undefined) byCurrency.set(cell.currency, [cell]);
      else bucket.push(cell);
    }
    const displayName = list[0]?.modelDictKey ?? list[0]?.modelKey ?? key;
    const modality = list[0]?.modality ?? null;
    for (const [currency, cells] of byCurrency) {
      // 「≥2 家报价」的闸落在**币种桶内**:CNY 一家 + USD 一家 = 谁也不可比价
      if (cells.length < 2) continue;
      const model = buildModel(key, displayName, modality, cells, currency);
      const group = groups.get(currency);
      if (group === undefined) {
        groups.set(currency, {
          currency,
          models: [model],
          providerKeys: cells.map((c) => c.providerKey),
        });
      } else {
        group.models.push(model);
        for (const c of cells) {
          if (!group.providerKeys.includes(c.providerKey)) group.providerKeys.push(c.providerKey);
        }
      }
    }
  }

  const out = [...groups.values()];
  for (const g of out) {
    g.models.sort((a, b) => {
      const pa = a.cells[0]?.inputPrice ?? null;
      const pb = b.cells[0]?.inputPrice ?? null;
      if (pa === null && pb === null) return a.key.localeCompare(b.key);
      if (pa === null) return 1;
      if (pb === null) return -1;
      if (pa !== pb) return pa - pb;
      return a.key.localeCompare(b.key);
    });
  }
  return out;
}

/** 单币种内的模型条目:组内按输入价升序,最低价标出 */
function buildModel(
  key: string,
  displayName: string,
  modality: string | null,
  unique: CompareCell[],
  currency: string,
): CompareModel {
  unique.sort((a, b) => {
    const pa = a.inputPrice;
    const pb = b.inputPrice;
    if (pa === null && pb === null) return 0;
    if (pa === null) return 1;
    if (pb === null) return -1;
    if (pa !== pb) return pa - pb;
    const oa = a.outputPrice;
    const ob = b.outputPrice;
    if (oa === null && ob === null) return 0;
    if (oa === null) return 1;
    if (ob === null) return -1;
    return oa - ob;
  });

  let cheapest: string | null = null;
  for (const cell of unique) {
    if (cell.inputPrice === null && cell.outputPrice === null) continue;
    if (cheapest === null) {
      cheapest = cell.providerKey;
      continue;
    }
    const best = unique.find((c) => c.providerKey === cheapest)!;
    if (cheaper(cell, best)) cheapest = cell.providerKey;
  }

  return {
    key,
    displayName,
    family: null,
    modality,
    currency,
    cells: unique,
    cheapestProviderKey: cheapest,
    providerCount: unique.length,
  };
}

/** 可比价的模型数(≥2 家报价);单家报价的模型不进矩阵 */
export function countComparableModels(rows: PublicModelRow[]): number {
  const providers = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = compareKeyOf(row);
    const set = providers.get(key);
    const pk = row.providerKey ?? row.vendor;
    if (set === undefined) providers.set(key, new Set([pk]));
    else set.add(pk);
  }
  let n = 0;
  for (const set of providers.values()) if (set.size >= 2) n += 1;
  return n;
}
