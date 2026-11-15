/**
 * 牌价域纯函数(M74 批A):键归一与价格语义判定。
 *
 * ⚠️ 本文件必须保持**零库依赖、零 env**(prerender-safe)——客户端组件可安全引入。
 * (同 public.ts 纪律:env 校验一旦被打进 /pricing/ 的 client chunk,浏览器里
 *  DATABASE_URL 缺失直接抛错、页面白屏,2026-11-01 生产事故。)
 *
 * 三级键的分工:
 * - `model_key`  规范键:去厂商前缀 → 小写 → 分隔符统一 '-' → 折叠 → 去首尾。
 *                 跨源可比对、跨厂商可聚(`qwen3-235b-a22b`)。
 * - `match_key`  归一锚:在 model_key 基础上再摘「日期快照/别名」后缀
 *                 (`gpt-4o-2024-08-06` → `gpt-4o`)——同一模型的快照版本归到
 *                 同一条字典行,字典表的去重锚。
 * - `family`     产品线:model_key 开头连续的非数字段
 *                 (`qwen3` / `deepseek-v3` / `doubao-seed`)。
 */

/** 厂商前缀(HF/仓库式 `org/model`)取末段;无 "/" 即原样 */
function stripOrgPrefix(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.includes("/")) return trimmed;
  return trimmed.split("/").pop() ?? trimmed;
}

/** 归一:小写 + 非字母数字/连字符一律折成 '-' + 折叠连续 '-' + 去首尾 '-' */
export function normalizeModelKey(raw: string): string {
  const base = stripOrgPrefix(raw).toLowerCase();
  if (base === "") return "";
  return base
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** 快照/别名后缀:日期快照(2024-08-06 / 20240806 / 0905)与 latest/preview/stable/exp */
const SNAPSHOT_SUFFIX_RE = /-(?:\d{4}-\d{2}-\d{2}|\d{8}|\d{4}|latest|preview|stable|exp)$/;

/** 归一锚:摘掉快照/别名后缀(至多两轮,「…-2024-08-06-latest」两轮才干净) */
export function normalizeMatchKey(raw: string): string {
  let key = normalizeModelKey(raw);
  for (let i = 0; i < 2; i += 1) {
    const next = key.replace(SNAPSHOT_SUFFIX_RE, "");
    if (next === key) break;
    key = next;
  }
  return key;
}

/**
 * 变体/规格后缀词(产品线的下一段是「变体」而不是「产品线」):
 * `deepseek-flash` 的产品线是 deepseek、`kimi-k2-instruct` 是 kimi-k2。
 * 命中即断(与数字段同理)。
 */
const VARIANT_TOKENS = new Set([
  "flash",
  "pro",
  "turbo",
  "lite",
  "mini",
  "max",
  "ultra",
  "plus",
  "instruct",
  "chat",
  "preview",
  "stable",
  "latest",
  "thinking",
  "reasoning",
  "vision",
  "coder",
  "air",
  "beta",
]);

/**
 * 产品线:开头连续的产品名段——数字段(235b / 2 / 8k)与变体词(flash / pro /
 * instruct)都视为产品线的下一段,到此为止。
 * `qwen3` / `deepseek-v3` / `doubao-seed` / `kimi-k2`;首段即数字则无产品线。
 */
export function deriveFamily(modelKey: string): string | null {
  const kept: string[] = [];
  for (const token of modelKey.split("-")) {
    if (token === "") continue;
    if (/^\d/.test(token)) break;
    if (VARIANT_TOKENS.has(token)) break;
    kept.push(token);
  }
  return kept.length === 0 ? null : kept.join("-");
}

/** 展示名:去厂商前缀后的原文(保留官方大小写,如 `Qwen3-235B-A22B`) */
export function displayNameFromModelKey(raw: string): string {
  return stripOrgPrefix(raw).trim();
}
