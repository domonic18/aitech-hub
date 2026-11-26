"use client";

/**
 * 自定义价格区间输入(UX P2):双输入框 + 应用按钮,替代固定 6 档的局限。
 * 应用时 band 自动置 all(互斥);清空时 pmin/pmax 回 null。
 */
import { useState } from "react";

export function PriceRangeInput({
  pmin,
  pmax,
  onApply,
}: {
  pmin: number | null;
  pmax: number | null;
  onApply: (min: number | null, max: number | null) => void;
}): React.ReactElement {
  const [minStr, setMinStr] = useState(pmin === null ? "" : String(pmin));
  const [maxStr, setMaxStr] = useState(pmax === null ? "" : String(pmax));

  const apply = (): void => {
    const min = minStr.trim() === "" ? null : Math.max(0, Math.floor(Number(minStr)));
    const max = maxStr.trim() === "" ? null : Math.max(0, Math.floor(Number(maxStr)));
    onApply(
      min !== null && Number.isFinite(min) ? min : null,
      max !== null && Number.isFinite(max) ? max : null,
    );
  };

  const input =
    "w-16 rounded-sm border border-line bg-panel-2 px-1.5 py-1 text-[11px] text-text-1 outline-none focus:border-accent";

  return (
    <div className="flex flex-wrap items-center gap-1">
      <input
        type="number"
        min={0}
        max={99999}
        value={minStr}
        placeholder="¥ 最低"
        aria-label="价格下界"
        onChange={(e) => setMinStr(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply();
        }}
        className={input}
      />
      <span className="text-[10px] text-text-3">–</span>
      <input
        type="number"
        min={0}
        max={99999}
        value={maxStr}
        placeholder="最高"
        aria-label="价格上界"
        onChange={(e) => setMaxStr(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply();
        }}
        className={input}
      />
      <button
        type="button"
        onClick={apply}
        className="cursor-pointer rounded-sm border border-accent bg-accent/10 px-2 py-1 text-[10px] text-accent hover:bg-accent/20"
      >
        确定
      </button>
      {(pmin !== null || pmax !== null) && (
        <button
          type="button"
          onClick={() => {
            setMinStr("");
            setMaxStr("");
            onApply(null, null);
          }}
          className="cursor-pointer text-[10px] text-text-3 hover:text-text-1"
        >
          清除
        </button>
      )}
    </div>
  );
}
