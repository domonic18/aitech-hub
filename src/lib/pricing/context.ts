/**
 * 上下文长度(纯函数、零依赖、零 env):由源页的「输入长度阶梯」推导上限,
 * 以及筛选用的上下文档。
 *
 * 为什么能推:官方牌价页的阶梯价按**单次请求输入长度**分档(如火山方舟
 * 「输入长度 (128, 256]」→ 256K、百炼「0<Token≤1M」→ 1M),档位上界就是该
 * 模型一次请求能吃下的最长上下文——阶梯到哪一档,上下文就是多少。
 *
 * 口径:**只推源页真给了阶梯的行**。源没给(腾讯云混元刊例价表、Kimi 牌价页
 * 都不带上下文)就留 null——页面显示「—」,不臆测一个数填上去。
 */

/** 上下文长度解析:"128K"→131072 / "1M"→1048576 / "200000"→200000;认不出 null */
export function parseContextTokens(raw: string | null): number | null {
  if (raw === null) return null;
  const t = raw.trim().toUpperCase();
  if (t === "") return null;
  const m = /^([\d.]+)\s*([KM])?$/.exec(t);
  if (m === null) return null;
  const v = Number(m[1]);
  if (Number.isNaN(v)) return null;
  const unit = m[2] ?? "";
  if (unit === "K") return v * 1024;
  if (unit === "M") return v * 1024 * 1024;
  return v;
}

/** 上下文区间档(筛选用):按「至少多少」分档,未知单列 */
export const CONTEXT_BANDS = [
  { id: "all", label: "全部", min: null },
  { id: "ge1m", label: "≥ 1M", min: 1024 * 1024 },
  { id: "ge256k", label: "≥ 256K", min: 256 * 1024 },
  { id: "ge128k", label: "≥ 128K", min: 128 * 1024 },
  { id: "lt128k", label: "< 128K", min: null },
  { id: "unknown", label: "未标注", min: null },
] as const;

export type ContextBandId = (typeof CONTEXT_BANDS)[number]["id"];

/** 上下文档命中判定(未知档只收未标注的行;其它档按 token 数下界) */
export function inContextBand(tokens: number | null, id: ContextBandId): boolean {
  if (id === "all") return true;
  if (id === "unknown") return tokens === null;
  if (id === "lt128k") return tokens !== null && tokens < 128 * 1024;
  const band = CONTEXT_BANDS.find((b) => b.id === id);
  if (band === undefined || band.min === null) return true;
  return tokens !== null && tokens >= band.min;
}

/** token 数 → 展示口径(「1M」/「256K」/「128K」;不是整 K/M 就原样给数) */
export function formatContextTokens(tokens: number | null): string | null {
  if (tokens === null || !Number.isFinite(tokens) || tokens <= 0) return null;
  if (tokens % (1024 * 1024) === 0) return `${tokens / (1024 * 1024)}M`;
  if (tokens % 1024 === 0) return `${tokens / 1024}K`;
  return String(tokens);
}

/**
 * 档位阶梯 → 上下文上限(token 数)。
 * 档位边界取「上界」;上界为 null(无上界的最高档,如「[128k, +∞)」)时取其
 * 下界——那一档的起点就是上下文封顶的位置。
 */
export function contextTokensFromTiers(
  tiers: ReadonlyArray<{ minTokens: number | null; maxTokens: number | null }>,
): number | null {
  let max: number | null = null;
  for (const t of tiers) {
    const bound = t.maxTokens ?? t.minTokens;
    if (bound === null || bound <= 0) continue;
    if (max === null || bound > max) max = bound;
  }
  return max;
}
