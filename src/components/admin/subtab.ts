/**
 * ?t= 子段解析(P2-19):SubTabs 页「TABS.some 钳制」三处逐字重复的收口——
 * 不在表内的 raw 一律钳回 fallback,杜绝裸 params 直查库。
 * tabs 兼容两种形态:纯键数组或 [键, 标签] 有序对(与 SubTabs 的 tabs 同形)。
 */
type TabEntry<K extends string> = K | readonly [K, ...unknown[]];

export function parseSubTab<K extends string>(
  tabs: readonly TabEntry<K>[],
  raw: string | undefined,
  fallback: K,
): K {
  for (const entry of tabs) {
    const key = typeof entry === "string" ? entry : entry[0];
    if (key === raw) return key;
  }
  return fallback;
}
