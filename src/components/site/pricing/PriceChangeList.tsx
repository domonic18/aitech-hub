/**
 * 降价史列表(M74 批F):展示「近 N 天采集口径下的降价记录」。
 *
 * 纯服务端组件(RSC,无 "use client"):数据已在服务端查好,这里只排版。
 * 与比价视图的分工:比价是**横向**同一模型跨提供商当前谁最便宜,这里是
 * **纵向**同一行自身的价格变动史,两者口径一致(代表价、原币直出)。
 */
import { formatPrice } from "@/lib/pricing/public";
import type { PublicPriceChange } from "@/lib/pricing/changes-read";

import { OfficialLink } from "./shared";

/** 降幅展示:百分比(一位小数)+ 旧价 → 新价(单位后缀由 formatPrice 带) */
function priceMove(c: PublicPriceChange): React.ReactElement {
  const tokenPriced = c.priceUnit === "per_1m_tokens" || c.priceUnit === "per_1k_tokens";
  const oldPrice = tokenPriced ? c.oldInputPrice : c.oldOutputPrice;
  const newPrice = tokenPriced ? c.newInputPrice : c.newOutputPrice;
  return (
    <span className="font-mono text-[13px] text-text-1">
      <span className="text-text-3 line-through">
        {formatPrice(oldPrice, c.currency, c.priceUnit)}
      </span>
      <span className="mx-1 text-text-3">→</span>
      {formatPrice(newPrice, c.currency, c.priceUnit)}
    </span>
  );
}

export function PriceChangeList({
  items,
  total,
}: {
  items: PublicPriceChange[];
  total: number;
}): React.ReactElement {
  if (items.length === 0) {
    return (
      <p className="border-t border-line px-4 py-8 text-center text-[12.5px] text-text-3">
        暂无降价记录 —— 降价记录自牌价监测上线后开始累计。
      </p>
    );
  }
  return (
    <div>
      <ul>
        {items.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line/50 px-4 py-3 last:border-b-0"
          >
            <span className="font-mono text-[13px] font-semibold text-text-1">{c.modelKey}</span>
            <span className="text-[11.5px] text-text-3">{c.providerName}</span>
            {priceMove(c)}
            {c.dropPct !== null && (
              <span className="font-mono text-[12px] text-green-hi">-{c.dropPct.toFixed(1)}%</span>
            )}
            <span className="ml-auto flex items-center gap-2 text-[11.5px] text-text-3">
              {c.sourceLabel !== null && <span>{c.sourceLabel}</span>}
              <span className="font-mono">{c.changedAt}</span>
              {c.sourceUrl !== null && <OfficialLink url={c.sourceUrl} />}
            </span>
          </li>
        ))}
      </ul>
      {total > items.length && (
        <p className="border-t border-line px-4 py-3 text-[11.5px] text-text-3">
          近 90 天共 {total} 条降价记录,此处展示最近 {items.length} 条。
        </p>
      )}
    </div>
  );
}
