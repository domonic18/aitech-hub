/**
 * 单价横向条形图几何(M74 批G):文生图/文生视频等**非 token 计价**模型的
 * 生成价对比——对数轴散点只对 token 双价成立,单价格模型用条形长度比大小。
 *
 * 纯函数(零库依赖零 env,同 scatter.ts 纪律):手写 SVG、禁图表库。
 *
 * 口径:
 * - **每模型一条**:取该模型**最便宜的一家**报价(代表价=生成价小者胜)——
 *   与散点「每模型一点」同一原则,回答「这模型最便宜能多少钱」
 * - **币种 × 单位分区**:原币直出不折算(跨币种不可比),元/张与元/秒
 *   量纲不同也不可比——各画各的块
 * - **0 价不入图**:完全免费模型条长为 0 无从比较,计入 skipped 图下说明
 * - 条长按**组内最大价**归一(线性刻度——单价跨度远小于 token 价,
 *   对数轴反而看不出倍差)
 */
import { isTokenPriced, representativePrice, unitLabel, type PublicModelRow } from "./public";

export const UNIT_BARS_MAX_W = 640;
export const UNIT_BARS_ROW_H = 26;
export const UNIT_BARS_MAX_ROWS = 24;
/** 左侧模型名区宽(名右对齐到 labelLeft-8) */
export const UNIT_BARS_LABEL_W = 210;
/** 右侧价格标注区宽(价格文本画在条右 +8,宽约 60) */
export const UNIT_BARS_PRICE_W = 88;

/**
 * 画布宽度:标签区 + **最大条长** + 价格标注区。
 *
 * 2026-11-18 修:此前误用 UNIT_BARS_MAX_ROWS(最大行数=24)当条长基数,画布只有
 * 210+24+88=322,而条长按 UNIT_BARS_MAX_W=640 归一 → 最贵的几条条子顶出画布、
 * 价格标签画在画布外(看不见价),且 SVG 被容器放大近 2 倍(字巨大)。
 */
export function unitBarsCanvasWidth(): number {
  return UNIT_BARS_LABEL_W + UNIT_BARS_MAX_W + UNIT_BARS_PRICE_W;
}

/** 一条(一个模型 × 其最便宜的一家) */
export interface UnitBar {
  id: string;
  displayName: string;
  providerName: string;
  /** 代表价(生成价) */
  price: number;
  /** 条长像素(按组内最大价线性归一;最小可见 2px) */
  width: number;
}

/** 一个 币种×单位 区块 */
export interface UnitBarGroup {
  currency: string;
  priceUnit: string;
  /** 区块标题里的单位中文(元/张、元/秒;空=token——但 token 行不进条形图) */
  unitSuffix: string;
  bars: UnitBar[];
  /** 0 价(完全免费)未入图的模型数 */
  skipped: number;
}

/** 取每模型最便宜的一家(代表价小者胜;null 视为无穷贵) */
function cheapestByModel(rows: PublicModelRow[]): PublicModelRow[] {
  const best = new Map<string, PublicModelRow>();
  for (const row of rows) {
    const key = row.modelDictKey ?? row.modelKey;
    const cur = best.get(key);
    const curPrice = cur === undefined ? null : representativePrice(cur);
    const price = representativePrice(row);
    if (cur === undefined || (price !== null && (curPrice === null || price < curPrice))) {
      best.set(key, row);
    }
  }
  return [...best.values()];
}

/** 条形几何装配(纯函数,单测锚) */
export function buildUnitPriceBars(rows: PublicModelRow[]): UnitBarGroup[] {
  const nonToken = rows.filter((r) => !isTokenPriced(r));
  const byPartition = new Map<string, PublicModelRow[]>();
  for (const row of cheapestByModel(nonToken)) {
    const key = `${row.currency}|${row.priceUnit}`;
    const bucket = byPartition.get(key);
    if (bucket === undefined) byPartition.set(key, [row]);
    else bucket.push(row);
  }

  const groups: UnitBarGroup[] = [];
  for (const [partition, models] of byPartition) {
    const [currency, priceUnit] = partition.split("|") as [string, string];
    const priced = models.filter((m) => {
      const p = representativePrice(m);
      return p !== null && p > 0;
    });
    const skipped = models.length - priced.length;
    priced.sort((a, b) => (representativePrice(a) ?? 0) - (representativePrice(b) ?? 0));
    const shown = priced.slice(0, UNIT_BARS_MAX_ROWS);
    const max = shown.reduce((m, r) => Math.max(m, representativePrice(r) ?? 0), 0);
    groups.push({
      currency,
      priceUnit,
      unitSuffix: unitLabel(priceUnit),
      skipped,
      bars: shown.map((r) => {
        const p = representativePrice(r) ?? 0;
        return {
          id: r.modelDictKey ?? r.modelKey,
          displayName: r.modelDictKey ?? r.modelKey,
          providerName: r.providerName ?? r.vendor,
          price: p,
          width: max <= 0 ? 0 : Math.max(2, Math.round((p / max) * UNIT_BARS_MAX_W)),
        };
      }),
    });
  }
  return groups;
}
