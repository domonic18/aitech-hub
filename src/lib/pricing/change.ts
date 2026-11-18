/**
 * 牌价变更判定(M74 批F):采集落库时对比库中现值,变了就留一行变更史。
 *
 * 纯函数、零库依赖(与 public.ts 同纪律)——写侧与读侧共用,前端也可引。
 *
 * 三条口径:
 * - **跨币种、跨计价单位不可比**:币种变了是「口径变更」不是降价(原币直出,
 *   ¥ 与 $ 的数字大小没有意义);计价单位变了(如从每百万 tokens 改成元/张)
 *   同理。两者都记变更行,但永不计入降价。
 * - **代表价口径**:与排序/比价/条形图一致(token 行=输入价,非 token 行=生成价);
 *   输入价变输出价没变时,看代表价所在的那一列。
 * - **未公布不是降价**:价 null(未公布)不参与比较,也不写行——「没公布价」与
 *   「降价」是两件事,混起来就是误导。
 */
import { representativePrice } from "./public";

/** 变更类型 */
export type PricingChangeKind = "drop" | "rise" | "unit_changed" | "currency_changed";

/** 参与比较的一行价格快照(采集落库前后的两侧) */
export interface PriceSnapshot {
  currency: string;
  priceUnit: string;
  inputPrice: number | null;
  outputPrice: number | null;
}

/** 判定结果 */
export interface PriceChange {
  kind: PricingChangeKind;
  /** 变更前代表价 */
  oldRepresentative: number | null;
  /** 变更后代表价 */
  newRepresentative: number | null;
  /** 降幅百分比(正数=降了几成;不可比/旧价为 0 或 null → null) */
  dropPct: number | null;
}

/** 价精度:与库里 Decimal(12,4) 对齐,避免 0.1 !== 0.10 的浮点误判 */
const PRICE_SCALE = 4;

/** 归一到固定精度(比较用) */
function norm(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return Number(v.toFixed(PRICE_SCALE));
}

/**
 * 代表价:直接复用 public.ts 的口径(排序/比价/条形图同一把尺),
 * 不另写一份——两份口径迟早分叉。
 */
function representative(s: PriceSnapshot): number | null {
  return norm(representativePrice(s));
}

/**
 * 判定一次价格变更:不该记的事件返回 null(价没变 / 未公布 / 口径不变)。
 * 口径变更(币种/单位)优先于涨跌判定。
 */
export function classifyChange(oldSnap: PriceSnapshot, newSnap: PriceSnapshot): PriceChange | null {
  const oldRep = representative(oldSnap);
  const newRep = representative(newSnap);
  const base = { oldRepresentative: oldRep, newRepresentative: newRep, dropPct: null };

  if (oldSnap.currency !== newSnap.currency) {
    return { ...base, kind: "currency_changed" };
  }
  if (oldSnap.priceUnit !== newSnap.priceUnit) {
    return { ...base, kind: "unit_changed" };
  }
  // 未公布价不参与比较:null 不是「最便宜」,也不是降价
  if (oldRep === null || newRep === null) return null;
  if (oldRep === newRep) return null;
  const kind: PricingChangeKind = newRep < oldRep ? "drop" : "rise";
  // 降幅百分比:旧价为 0 时百分比无意义(从 0 涨到任何数不是「涨了百分之多少」)
  const dropPct = oldRep > 0 ? ((oldRep - newRep) / oldRep) * 100 : null;
  return { kind, oldRepresentative: oldRep, newRepresentative: newRep, dropPct };
}

/** 是否是「降价」(跨币种/跨单位永不是) */
export function isDrop(kind: PricingChangeKind): boolean {
  return kind === "drop";
}
