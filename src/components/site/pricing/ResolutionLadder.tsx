"use client";

/**
 * 分辨率档位展示(文生图/文生视频):价格随分辨率分档,行上只挂一个基准价 →
 * 前台必须让用户看到「这个价对应哪个分辨率」+ 其余分辨率多少钱。
 *
 * token 行没有分辨率维度 → 一律不渲染(不占位)。
 */
import { isTokenPriced, type PublicModelRow } from "@/lib/pricing/public";
import { rowResolution, tierResolution } from "@/lib/pricing/resolution";

/** 一档分辨率价(标签 + 价 + 是否推断) */
interface ResolutionPrice {
  label: string;
  price: number;
  inferred: boolean;
}

/** 分辨率档位阶梯(按张/按秒行) */
function ladderOf(row: PublicModelRow): ResolutionPrice[] {
  if (isTokenPriced(row)) return [];
  const out: ResolutionPrice[] = [];
  for (const t of row.tiers) {
    if (tierResolution(t) === null) continue;
    const price = t.outputPrice ?? t.inputPrice;
    if (price === null) continue;
    out.push({ label: t.tierLabel, price, inferred: t.params?.source === "inferred" });
  }
  return out;
}

/** 行价对应的分辨率(与行价同价的第一档);token 行/无档位 → null */
export function basisResolution(row: PublicModelRow): string | null {
  if (isTokenPriced(row)) return null;
  return rowResolution(row);
}

/** 分辨率阶梯折叠块(表格与卡片共用) */
export function ResolutionLadder({ row }: { row: PublicModelRow }): React.ReactElement | null {
  const ladder = ladderOf(row);
  if (ladder.length <= 1) return null;
  return (
    <details className="mt-1 text-[11px] text-text-3">
      <summary className="cursor-pointer select-none">{ladder.length} 个分辨率档位</summary>
      <ul className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5">
        {ladder.map((t) => (
          <li key={t.label} className="font-mono">
            <span className="text-text-2">{t.label}</span> {t.price}
            {t.inferred && <span className="ml-1 text-amber-500">推断</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}
