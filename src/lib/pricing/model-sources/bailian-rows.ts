/**
 * 百炼牌价的「行归一」层(M77 拆出):把表内记录按模型归一,维度组合落档位,
 * 并定行价基准。
 *
 * 行价基准分两种口径:
 * - token 表:取「全球」档(国内用户口径),没有则取第一条有价的
 * - 按张/按秒表:档位维度是**分辨率**,取**最低分辨率档**(入口价)——
 *   同分辨率多行取价低的那条
 *
 * 行价对应的分辨率写进 note(「… · 1k 分辨率」):文生图/文生视频的价格随分辨率
 * 分档,只挂一个价必须能追溯它对应哪个分辨率。
 */
import type { ModelPrefillRow, ModelTierPrefill } from "../crawlers";
import { resolutionRank } from "../resolution";
import { isTokenUnit } from "../units";

/** 单行表记录 */
export interface BailianRow {
  modelId: string;
  note: string;
  scope: string | null;
  mode: string | null;
  tokenRange: string | null;
  /** 档位维度原文(分辨率/视频类型/参考类型;与 tokenRange 互斥出现) */
  cond: string | null;
  input: number | null;
  cache: number | null;
  output: number | null;
  free: string | null;
  /** 行级计价单位(批G;随表) */
  unit: string;
}

/** 「0<Token≤1M」→ {min, max}(token 数);不可解析 → null */
function tokenRangeOf(text: string): { min: number | null; max: number | null } {
  const toNum = (s: string): number | null => {
    const m = /^([\d.]+)([KkMm])?$/.exec(s.trim());
    if (m === null) return null;
    const v = Number(m[1]);
    const unit = (m[2] ?? "").toLowerCase();
    if (unit === "k") return v * 1024;
    if (unit === "m") return v * 1024 * 1024;
    return v;
  };
  const m = /([\d.]+[KkMm]?)\s*<\s*Token\s*≤\s*([\d.]+[KkMm]?)/.exec(text);
  if (m === null) return { min: null, max: null };
  return { min: toNum(m[1] ?? ""), max: toNum(m[2] ?? "") };
}

/** 档位标签:部署范围 · 模式 · 档位维度(Token 区间或分辨率/类型;缺省项不拼) */
function tierLabelOf(row: BailianRow): string {
  const parts = [row.scope, row.mode, row.tokenRange ?? row.cond].filter(
    (v) => v !== null && v !== "",
  );
  return parts.length === 0 ? "默认" : parts.join("·");
}

/** token 表行价基准:「全球」档优先(国内用户口径),否则第一条有价的 */
function tokenBase(rows: BailianRow[]): BailianRow {
  return (
    rows.find((r) => r.scope === "全球") ??
    rows.find((r) => r.input !== null || r.output !== null) ??
    rows[0]!
  );
}

/**
 * 按张/按秒表行价基准:**最低分辨率档**(入口价)。
 * 部署范围有「全球」列时只在全球行里挑(与 token 表同口径);同价多档取最低分辨率。
 */
function resolutionBase(rows: BailianRow[]): BailianRow {
  const priced = rows.filter((r) => r.input !== null || r.output !== null);
  const globalRows = priced.filter((r) => r.scope === "全球" || r.scope === null);
  const pool = globalRows.length > 0 ? globalRows : priced;
  const withRes = pool.filter((r) => resolutionRank(r.cond) !== null);
  if (withRes.length === 0) return pool[0] ?? rows[0]!;
  return withRes.reduce((a, b) => {
    const am = resolutionRank(a.cond)!;
    const bm = resolutionRank(b.cond)!;
    if (am !== bm) return bm < am ? b : a;
    // 同分辨率多行(如「全球」与无范围两张表式):取价低的那条
    const ap = a.output ?? a.input ?? Number.POSITIVE_INFINITY;
    const bp = b.output ?? b.input ?? Number.POSITIVE_INFINITY;
    return bp < ap ? b : a;
  });
}

/**
 * 记录 → 牌价行(一行一模型,维度组合落档位)。
 * 模型 → 表级显式模态(按张表→image;按秒表带「视频」表头→video)随行带出。
 */
export function bailianRowsToPrefill(
  byModel: Map<string, BailianRow[]>,
  tableModalityByModel: Map<string, string>,
  now: Date,
  sourceUrl: string,
): ModelPrefillRow[] {
  const out: ModelPrefillRow[] = [];
  for (const [modelId, allRows] of byModel) {
    // 同一模型若跨单位表出现(罕见),保 token 系记录,不混单位落档
    const units = new Set(allRows.map((r) => r.unit));
    let rows = allRows;
    if (units.size > 1) {
      const keep = units.has("per_1m_tokens")
        ? "per_1m_tokens"
        : units.has("per_1k_tokens")
          ? "per_1k_tokens"
          : allRows[0]!.unit;
      rows = allRows.filter((r) => r.unit === keep);
    }
    const unit = rows[0]!.unit;

    const tiers: ModelTierPrefill[] = [];
    for (const rec of rows) {
      const range = tokenRangeOf(rec.tokenRange ?? "");
      const label = tierLabelOf(rec);
      const tier: ModelTierPrefill = {
        tierLabel: label,
        inputPrice: rec.input,
        outputPrice: rec.output,
        cachePrice: rec.cache,
        minTokens: range.min,
        maxTokens: range.max,
        unit,
      };
      // 档位唯一键是 (牌价行, 标签):同名同价是同一事实(两张表重复列)→ 去重;
      // 同名不同价 → 加序号区分(否则落库撞唯一键)
      const dup = tiers.find((t) => t.tierLabel === tier.tierLabel);
      if (dup !== undefined) {
        if (
          dup.inputPrice === tier.inputPrice &&
          dup.outputPrice === tier.outputPrice &&
          dup.cachePrice === tier.cachePrice
        ) {
          continue;
        }
        let n = 2;
        while (tiers.some((t) => t.tierLabel === `${label}·${n}`)) n += 1;
        tier.tierLabel = `${label}·${n}`;
      }
      tiers.push(tier);
    }
    // 「无部署范围」档位与「全球」档同价时去重:百炼有些表不带部署范围列,
    // 与带列的「全球」行是同一事实的两种表式(不做此去重会重复展示同一价)
    const globalTier = tiers.find((t) => t.tierLabel.startsWith("全球·"));
    if (globalTier !== undefined) {
      const same = (t: ModelTierPrefill): boolean =>
        t.inputPrice === globalTier.inputPrice &&
        t.outputPrice === globalTier.outputPrice &&
        t.cachePrice === globalTier.cachePrice;
      const kept = tiers.filter((t) => t.tierLabel.startsWith("全球·") || !same(t));
      tiers.length = 0;
      tiers.push(...kept);
    }
    const base = isTokenUnit(unit) ? tokenBase(rows) : resolutionBase(rows);
    // 行价对应的分辨率(非 token 行):写进 note,让「这个价是哪个分辨率」可追溯
    const res = resolutionRank(base.cond) !== null ? base.cond : null;
    out.push({
      vendor: "阿里云百炼",
      modelKey: modelId,
      currency: "CNY",
      inputPrice: base.input,
      outputPrice: base.output,
      contextWindow: null,
      note: `[官方页爬虫 ${now.toISOString().slice(0, 10)}] ${base.note}${
        res === null ? "" : ` · ${res} 分辨率`
      }`,
      dataAsOf: now,
      sourceUrl,
      region: "cn",
      providerKey: "aliyun-bailian",
      freeTier: rows.find((r) => r.free !== null)?.free ?? null,
      modality: tableModalityByModel.get(modelId),
      priceUnit: unit,
      tiers,
    });
  }
  return out;
}
