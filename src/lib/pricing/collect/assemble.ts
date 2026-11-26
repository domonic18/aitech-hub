/**
 * 采集侧行组装(牌价改造 P2 收尾):把「已经过好列语义/单位/基准价策略」的
 * 原始记录组装成 ModelPrefillRow[],补上新源最后两公里的公共逻辑:
 * - 同名档位的去重与序号化
 * - 行价基准的选取(token 系/模态计价)
 * - 档位标签生成、免费额度注记、params 解析
 *
 * 各源 adapter 只需做三件事:fetch、parse → 原始记录、声明口径(unit/基准策略);
 * 列语义/单位/基准价由 collect 层其他模块处理。
 */
import { pushPrefillTier, type ModelPrefillRow, type ModelTierPrefill } from "../crawlers";
import { isTokenUnit, normalizedUnit } from "../units";

import { pickResolutionBase, pickTokenBase, type BasePriceRecord } from "./base-price";

/** 原始记录(列语义已经解析完毕,字段均为可选,源按需填) */
export interface RawPricingRecord {
  modelKey: string;
  /** 部署范围/地域,如「全球」 */
  scope?: string | null;
  /** 模式/思考模式 */
  mode?: string | null;
  /** 档位维度:分辨率/视频类型/参考类型 */
  cond?: string | null;
  /** token 阶梯范围原文,如「[0, 32K)」 */
  tokenRange?: string | null;
  input?: number | null;
  output?: number | null;
  cache?: number | null;
  /** 输入输出同价(如「输入和输出(元/秒)」) */
  combined?: number | null;
  /** 免费额度原文 */
  free?: string | null;
}

/** 组装口径 */
export interface AssembleOptions {
  vendor: string;
  currency: "CNY" | "USD";
  sourceUrl: string;
  region: "cn" | "intl";
  dataAsOf: Date;
  /** 计价单位(应已被 collect/units 归一到 per_1m_tokens/per_image/...之一) */
  unit: string;
  /** 厂商规范键;缺省不传 */
  providerKey?: string;
  /** 模态显式标注;缺省由下游推断 */
  modality?: string | null;
  /** 行价基准策略;缺省按 unit 是否为 token 系自动判断 */
  baseStrategy?: "token" | "resolution";
  /** 档位标签生成器;缺省用默认 builder */
  tierLabelOf?: (r: RawPricingRecord) => string;
}

const SCOPE_GLOBAL = "全球";

/** 默认档位标签:按 scope·mode·cond·tokenRange 拼接,空段跳过 */
export function defaultTierLabelOf(r: RawPricingRecord): string {
  const parts: string[] = [];
  if (r.scope && r.scope !== SCOPE_GLOBAL) parts.push(r.scope);
  if (r.mode) parts.push(r.mode);
  if (r.cond) parts.push(r.cond);
  if (r.tokenRange) parts.push(r.tokenRange);
  return parts.length === 0 ? "默认" : parts.join("·");
}

function resolvedBaseStrategy(
  unit: string,
  explicit?: "token" | "resolution",
): "token" | "resolution" {
  if (explicit) return explicit;
  return isTokenUnit(unit) ? "token" : "resolution";
}

function toBaseRecord(r: RawPricingRecord): BasePriceRecord {
  const input = r.input ?? (r.combined !== undefined ? r.combined : null);
  const output = r.output ?? (r.combined !== undefined ? r.combined : null);
  return {
    scope: r.scope ?? null,
    cond: r.cond ?? null,
    input: input ?? null,
    output: output ?? null,
  };
}

function buildTier(
  r: RawPricingRecord,
  unit: string,
  labelOf: (r: RawPricingRecord) => string,
): ModelTierPrefill {
  const combined = r.combined;
  const inputPrice = combined !== undefined ? combined : r.input;
  const outputPrice = combined !== undefined ? combined : r.output;
  const tier: ModelTierPrefill = {
    tierLabel: labelOf(r),
    inputPrice: inputPrice ?? null,
    outputPrice: outputPrice ?? null,
    cachePrice: r.cache ?? null,
    minTokens: null,
    maxTokens: null,
    unit: normalizedUnit(unit),
  };
  // token 阶梯范围解析(min/max)可后续由调用方补,这里保持最小公共层
  return tier;
}

/**
 * 把原始记录组装成 ModelPrefillRow。
 * 同一 modelKey 的多条记录视为同一模型的多个档位;
 * 行价按 baseStrategy 取入口价,档位集整批替换(与 model-persist 同口径)。
 */
export function assembleModelPrefillRows(
  records: RawPricingRecord[],
  opts: AssembleOptions,
): ModelPrefillRow[] {
  const labelOf = opts.tierLabelOf ?? defaultTierLabelOf;
  const strategy = resolvedBaseStrategy(opts.unit, opts.baseStrategy);
  const byModel = new Map<string, RawPricingRecord[]>();
  for (const r of records) {
    const key = r.modelKey.trim();
    if (key === "") continue;
    const list = byModel.get(key);
    if (list === undefined) {
      byModel.set(key, [r]);
    } else {
      list.push(r);
    }
  }

  const out: ModelPrefillRow[] = [];
  for (const [modelKey, recs] of byModel) {
    const base =
      strategy === "token"
        ? pickTokenBase(recs.map(toBaseRecord))
        : pickResolutionBase(recs.map(toBaseRecord));

    const tiers: ModelTierPrefill[] = [];
    for (const r of recs) {
      pushPrefillTier(tiers, buildTier(r, opts.unit, labelOf));
    }

    const freeParts = recs.map((r) => r.free).filter((v): v is string => Boolean(v));
    const freeTier = freeParts.length > 0 ? freeParts.join("; ") : null;

    out.push({
      vendor: opts.vendor,
      modelKey,
      currency: opts.currency,
      inputPrice: base.input ?? null,
      outputPrice: base.output ?? null,
      contextWindow: null,
      note: freeTier ?? "",
      dataAsOf: opts.dataAsOf,
      sourceUrl: opts.sourceUrl,
      region: opts.region,
      providerKey: opts.providerKey,
      modality: opts.modality,
      priceUnit: normalizedUnit(opts.unit),
      freeTier,
      tiers,
    });
  }
  return out;
}
