/**
 * preset 数据归一(工具参数漂移收编层):弱模型(MiniMax)会把 JSON 数组包进
 * 单键对象再发,实证形态 {"item":[…]} 与 {"item":{"item":[…]}}(render_card
 * ledger rows 整线程三连败、checkpoint 取证 2026-10-18;与 ask_user options
 * 漂移同源同键名,见 arch/04 工具参数漂移归一层)。本层在 zod 校验前递归
 * 展开「单键 item 且链终为数组」的包裹;只收编实证形态,其余一切原样透传,
 * 交 zod fail-closed 报错。normalized 标志供调用方记日志观测漂移率。
 */

type Rec = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isItemWrapped = (v: unknown): v is Rec & { item: unknown } =>
  isPlainObject(v) && Object.keys(v).length === 1 && "item" in v;

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

/** 递归归一:数组元素与对象值都下钻;包裹展开后对展开结果继续归一。
 *  全程未变更时返回原引用,调用方可据 normalized 可靠判零漂移。 */
export function normalizePresetData(data: unknown): { data: unknown; normalized: boolean } {
  if (Array.isArray(data)) {
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
