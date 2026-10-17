/**
 * preset 数据归一(工具参数漂移收编层):弱模型(MiniMax)的数组形态漂移,
 * 全部实证自 render_card ledger/matrix 失败线程的 checkpoint 取证(2026-10-18,
 * 与 ask_user options 漂移同源,见 arch/04 工具参数漂移归一层):
 * ① 单键包裹 {"item":[…]} / {"item":{"item":[…]}}(首例取证形态)
 * ② 字符串化 JSON:rows="[ [{…},…] ]"(JSON.stringify 后再嵌一层引号)
 * ③ 双重嵌套数组 [[{…},…]](自纠时越修越歪的产物)
 * ④ 二元数组行 [["键","值"],…](应写 {"k":…,"v":…};ledger rows 消费形态,
 *    无 preset 合法消费数组套数组,零冲突)
 * 本层在 zod 校验前递归收编以上形态;只收编实证形态,其余一切原样透传,
 * 交 zod fail-closed 报错(报错文案在 presets.ts#formatPresetError,带具体
 * 收到形态与修正示例,供 1~2 轮自纠)。normalized 标志供调用方记日志观测漂移率。
 */

type Rec = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isItemWrapped = (v: unknown): v is Rec & { item: unknown } =>
  isPlainObject(v) && Object.keys(v).length === 1 && "item" in v;

/** 字符串化 JSON 候选:trim 后以 [ 或 { 开头(含长度闸防超大串白耗解析) */
const isEncodedJson = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 100_000 && /^[[{]/.test(v.trimStart());

/** 二元数组行:每项都是「长度 2 且全字符串」的数组(ledger rows 漂移形态) */
const isPairRows = (v: unknown): v is unknown[][] =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.every((r) => Array.isArray(r) && r.length === 2 && r.every((c) => typeof c === "string"));

/** 单元素外层数组 [[…]](双重嵌套漂移形态;首项非数组不收编) */
const isSingleArrayWrap = (v: unknown): v is [unknown] =>
  Array.isArray(v) && v.length === 1 && Array.isArray(v[0]);

/** 展开 {item:{item:[…]}} / {item:[…]};链终非数组不收编(原样交 zod)。 */
function unwrapItemChain(value: unknown): { data: unknown; changed: boolean } {
  if (!isItemWrapped(value)) return { data: value, changed: false };
  let cur: unknown = value;
  while (isItemWrapped(cur)) {
    const next = cur.item;
    if (Array.isArray(next)) return { data: next, changed: true };
    if (!isItemWrapped(next)) return { data: value, changed: false };
    cur = next;
  }
  return { data: value, changed: false };
}

/** 递归归一:数组元素与对象值都下钻;收编展开后对展开结果继续归一。
 *  全程未变更时返回原引用,调用方可据 normalized 可靠判零漂移。 */
export function normalizePresetData(data: unknown): { data: unknown; normalized: boolean } {
  // ② 字符串化 JSON:解析成功且为对象/数组则对解析结果继续归一;解析失败
  //    (含以 [ 开头的普通文案,如 "[2026 新进展] …")原样透传。
  if (isEncodedJson(data)) {
    try {
      const parsed: unknown = JSON.parse(data);
      if (isPlainObject(parsed) || Array.isArray(parsed)) {
        const r = normalizePresetData(parsed);
        return r.normalized ? r : { data: r.data, normalized: true };
      }
    } catch {
      // 非 JSON 字符串,透传
    }
    return { data, normalized: false };
  }
  if (Array.isArray(data)) {
    // ④ 二元数组行 → {k,v} 对象数组(ledger rows 语义;无合法冲突形态)
    if (isPairRows(data)) {
      return { data: data.map(([k, v]) => ({ k, v })), normalized: true };
    }
    // ③ 单元素外层剥壳 [[…]] → […](剥壳后继续归一内侧)
    if (isSingleArrayWrap(data)) {
      return { data: normalizePresetData(data[0]).data, normalized: true };
    }
    let changed = false;
    const items = data.map((x) => {
      const r = normalizePresetData(x);
      changed ||= r.normalized;
      return r.data;
    });
    return changed ? { data: items, normalized: true } : { data, normalized: false };
  }
  if (!isPlainObject(data)) return { data, normalized: false };
  const unwrapped = unwrapItemChain(data);
  if (unwrapped.changed) {
    const inner = normalizePresetData(unwrapped.data);
    return { data: inner.data, normalized: true };
  }
  let changed = false;
  const out: Rec = {};
  for (const [k, v] of Object.entries(data)) {
    const r = normalizePresetData(v);
    changed ||= r.normalized;
    out[k] = r.data;
  }
  return changed ? { data: out, normalized: true } : { data, normalized: false };
}
