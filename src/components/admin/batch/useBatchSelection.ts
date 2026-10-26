"use client";

/**
 * 行多选 Hook(M31 验收反馈:六后台面批量治理共用):本页 Set 选择态 +
 * 全选/反选。ids 传当前页行 id 序列(翻页即重选,不跨页累积——与 PostsTable
 * 既有口径一致)。
 */
import { useCallback, useState } from "react";

export function useBatchSelection(ids: string[]): {
  selected: Set<string>;
  allSelected: boolean;
  toggle: (id: string) => void;
  toggleAll: () => void;
  clear: () => void;
} {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const toggle = useCallback((id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleAll = useCallback((): void => {
    setSelected(allSelected ? new Set() : new Set(ids));
  }, [allSelected, ids]);
  const clear = useCallback((): void => setSelected(new Set()), []);
  return { selected, allSelected, toggle, toggleAll, clear };
}
