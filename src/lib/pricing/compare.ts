/**
 * 牌价比价装配(M74 批D;批G 增单位维度):同一模型跨提供商并排比价 + 散点数据。
 *
 * 纯函数(零库依赖零 env)——前台客户端组件直接引,同 public.ts 纪律。
 *
 * 三条口径:
 * - **比价只在同币种内成立**:现口径是「原币直出不折算」(D4),跨币种比大小
 *   是假的。故按**单元格**的币种分区(同一模型的 CNY 报价进 CNY 区、USD 进 USD 区),
 *   区内才比大小。
 * - **比价只在同计价单位内成立**(批G):同一模型一家按百万 token 计价、另一家
 *   按张计价,两个数不可比——分区键为 币种 × 单位,跨单位的格互不进同区。
 * - **最低价高亮看代表价**:token 行输入价优先(相同比输出价),非 token 行
 *   看生成价;未公布价(null)不参与比较(「未公布」不是「最便宜」)。
 */
import {
  isTokenPriced,
  representativePrice,
  type PublicModelRow,
  type PublicTierRow,
} from "./public";
import type { ApiProtocol } from "./protocols";

/** 一个模型在某提供商的报价 */
export interface CompareCell {
  providerKey: string;
  providerName: string;
  vendor: string;
  inputPrice: number | null;
  outputPrice: number | null;
  priceUnit: string;
  currency: string;
  sourceUrl: string;
  dataAsOf: string;
  isFree: boolean;
  /** 该报价可用的 API 协议(策展规则;空 = 未标注) */
  protocols: ApiProtocol[];
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
  /** 归入的单位区(批G) */
  priceUnit: string;
  /** 各提供商报价(按代表价升序,null 最后) */
  cells: CompareCell[];
  /** 最低代表价的提供商 key(同币种同单位内;无有效价则 null) */
  cheapestProviderKey: string | null;
  /** 报价家数 */
  providerCount: number;
}

/** 一个币种×单位区 */
export interface CompareGroup {
  currency: string;
  priceUnit: string;
  models: CompareModel[];
  /** 本区出现的提供商(按首次出现序) */
  providerKeys: string[];
  /** 超过每区上限被截断的模型数(批D8;组内已按代表价升序,截掉的是更贵的) */
  truncated: number;
}

/** 每区(币种×单位)展示的模型上限(批D8):聚合源铺开后组内模型无界,
 *  矩阵 DOM 与档位 <details> 会拖垮首屏;超限按价升序保留,并明示截断 */
export const COMPARE_MAX_MODELS_PER_GROUP = 50;

/** 行 → 单元格(取该行在指定提供商下的报价) */
function cellOf(row: PublicModelRow): CompareCell {
  return {
    providerKey: row.providerKey ?? row.vendor,
    providerName: row.providerName ?? row.vendor,
    vendor: row.vendor,
    inputPrice: row.inputPrice,
    outputPrice: row.outputPrice,
    priceUnit: row.priceUnit,
    currency: row.currency,
    sourceUrl: row.sourceUrl,
    dataAsOf: row.dataAsOf,
    isFree: row.isFree,
    protocols: row.protocols,
    tiers: row.tiers,
  };
}

/** 归一键:优先模型字典键(跨厂商同一模型聚一起),未归一则回退原始模型键 */
export function compareKeyOf(row: PublicModelRow): string {
  return row.modelDictKey ?? row.modelKey;
}

/** 区键:币种 × 单位(跨币种或跨单位都不可比) */
function cellPartitionKey(cell: CompareCell): string {
  return `${cell.currency}|${cell.priceUnit}`;
}

/** 最低价判定:代表价小者胜;token 行代表价相同时比输出价;null 不参与 */
function cheaper(a: CompareCell, b: CompareCell): boolean {
  const ra = representativePrice(a);
  const rb = representativePrice(b);
  if (ra === null) return false;
  if (rb === null) return true;
  if (ra !== rb) return ra < rb;
  if (!isTokenPriced(a)) return false; // 非 token 行只有一个价,代表价相等即相等
  if (a.outputPrice === null) return false;
  if (b.outputPrice === null) return true;
  return a.outputPrice < b.outputPrice;
}

/**
 * 比价装配:按归一键聚合模型 → 按 币种×单位 分区 → 区内容纳 ≥2 家报价的模型。
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
    // 同一提供商多行(同模型的档位行/快照)取代表价最低的一条为代表
    const byProvider = new Map<string, CompareCell>();
    for (const cell of cells) {
      const prev = byProvider.get(cell.providerKey);
      if (prev === undefined || cheaper(cell, prev)) byProvider.set(cell.providerKey, cell);
    }
    const unique = [...byProvider.values()];

    // 按**单元格**的 币种×单位 拆:同一模型的 CNY 报价进 CNY 区、USD 进 USD 区,
    // token 计价与按张计价的格也各归各区(跨单位比大小是假的)
    const byPartition = new Map<string, CompareCell[]>();
    for (const cell of unique) {
      const bucket = byPartition.get(cellPartitionKey(cell));
      if (bucket === undefined) byPartition.set(cellPartitionKey(cell), [cell]);
      else bucket.push(cell);
    }
    const displayName = list[0]?.modelDictKey ?? list[0]?.modelKey ?? key;
    const modality = list[0]?.modality ?? null;
    for (const [partition, partCells] of byPartition) {
      // 「≥2 家报价」的闸落在**分区桶内**:CNY 一家 + USD 一家 = 谁也不可比价
      if (partCells.length < 2) continue;
      const [currency, priceUnit] = partition.split("|") as [string, string];
      const model = buildModel(key, displayName, modality, partCells, currency, priceUnit);
      const group = groups.get(partition);
      if (group === undefined) {
        groups.set(partition, {
          currency,
          priceUnit,
          models: [model],
          providerKeys: partCells.map((c) => c.providerKey),
          truncated: 0,
        });
      } else {
        group.models.push(model);
        for (const c of partCells) {
          if (!group.providerKeys.includes(c.providerKey)) group.providerKeys.push(c.providerKey);
        }
      }
    }
  }

  const out = [...groups.values()];
  for (const g of out) {
    g.models.sort((a, b) => {
      const pa = representativePrice(
        a.cells[0] ?? { priceUnit: g.priceUnit, inputPrice: null, outputPrice: null },
      );
      const pb = representativePrice(
        b.cells[0] ?? { priceUnit: g.priceUnit, inputPrice: null, outputPrice: null },
      );
      if (pa === null && pb === null) return a.key.localeCompare(b.key);
      if (pa === null) return 1;
      if (pb === null) return -1;
      if (pa !== pb) return pa - pb;
      return a.key.localeCompare(b.key);
    });
    // 批D8 截断:排序后切前 N(组内已按代表价升序,截掉的是更贵的)
    if (g.models.length > COMPARE_MAX_MODELS_PER_GROUP) {
      g.truncated = g.models.length - COMPARE_MAX_MODELS_PER_GROUP;
      g.models = g.models.slice(0, COMPARE_MAX_MODELS_PER_GROUP);
    }
  }
  return out;
}

/** 单区内的模型条目:组内按代表价升序,最低价标出 */
function buildModel(
  key: string,
  displayName: string,
  modality: string | null,
  unique: CompareCell[],
  currency: string,
  priceUnit: string,
): CompareModel {
  unique.sort((a, b) => {
    const pa = representativePrice(a);
    const pb = representativePrice(b);
    if (pa === null && pb === null) return 0;
    if (pa === null) return 1;
    if (pb === null) return -1;
    if (pa !== pb) return pa - pb;
    if (isTokenPriced(a)) {
      const oa = a.outputPrice;
      const ob = b.outputPrice;
      if (oa === null && ob === null) return 0;
      if (oa === null) return 1;
      if (ob === null) return -1;
      return oa - ob;
    }
    return 0;
  });

  let cheapest: string | null = null;
  for (const cell of unique) {
    if (representativePrice(cell) === null) continue;
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
    priceUnit,
    cells: unique,
    cheapestProviderKey: cheapest,
    providerCount: unique.length,
  };
}

/** 可比价的模型数(≥2 家报价且同币种同单位);单家/跨单位不可比的模型不进矩阵 */
export function countComparableModels(rows: PublicModelRow[]): number {
  const providers = new Map<string, Map<string, Set<string>>>();
  for (const row of rows) {
    const key = compareKeyOf(row);
    const pk = row.providerKey ?? row.vendor;
    let byPartition = providers.get(key);
    if (byPartition === undefined) {
      byPartition = new Map();
      providers.set(key, byPartition);
    }
    const partition = `${row.currency}|${row.priceUnit}`;
    const set = byPartition.get(partition);
    if (set === undefined) byPartition.set(partition, new Set([pk]));
    else set.add(pk);
  }
  let n = 0;
  for (const byPartition of providers.values()) {
    for (const set of byPartition.values()) if (set.size >= 2) n += 1;
  }
  return n;
}
