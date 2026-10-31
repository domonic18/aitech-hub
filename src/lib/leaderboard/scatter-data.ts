/**
 * 榜单行 → 散点输入适配(M63 v2):两块榜共用同一套几何(scatter.ts),差别只
 * 在两轴语义与刻度格式——集中在这里,组件不再各自拼映射。
 */
import type { PublicLeaderboard, PublicLeaderboardRow } from "./public";
import {
  compactTickLabel,
  cnyLabel,
  priceLabel,
  type ScatterDatum,
  type ScatterOptions,
} from "./scatter";

/** 展示币种:人民币默认(汇率折算),美元为上游原口径 */
export type ScatterCurrency = "cny" | "usd";

function displayName(row: PublicLeaderboardRow): string {
  return row.entityName === "" ? row.entityKey : row.entityName;
}

/** Hugging Face 模型 id 形如 org/model:标注只留模型名,组织由配色/图例承担 */
function shortModelName(row: PublicLeaderboardRow): string {
  const name = displayName(row);
  const slash = name.lastIndexOf("/");
  return slash >= 0 && slash < name.length - 1 ? name.slice(slash + 1) : name;
}

/** 模型能力与价格:x = 输出价(log),y = 能力分(linear);刻度格式随币种 */
export function modelScatterOptions(currency: ScatterCurrency = "cny"): ScatterOptions {
  return {
    x: { scale: "log", format: currency === "cny" ? cnyLabel : priceLabel },
    y: { scale: "linear", format: (v) => String(Number(v.toFixed(1))) },
    labelOrder: "value",
  };
}

/**
 * rate = 1 USD 折合展示币种值(美元口径传 1):x 值一律换成展示币种。
 * 对数轴下乘常数只平移域,点位与域宽与币种无关——两币共用同一份几何布局,
 * 差异仅在刻度值;刻度由各币种域各自原生生成(¥10/¥20/¥50,不是 $5 换算成 ¥33.3)。
 */
export function modelScatterData(board: PublicLeaderboard, rate = 1): ScatterDatum[] {
  return board.rows.map((row) => {
    const usd = row.extra.price1mOutputTokens ?? null;
    return {
      key: row.entityKey,
      name: displayName(row),
      vendor: row.vendor,
      x: usd === null ? null : usd * rate,
      y: row.score,
      rank: row.rank,
      hollow: row.extra.isOpenWeights === true,
    };
  });
}

/** Hugging Face 热门:x = 下载量(log),y = 点赞数(log) */
export const HF_SCATTER_OPTIONS: ScatterOptions = {
  x: { scale: "log", format: compactTickLabel },
  y: { scale: "log", format: compactTickLabel },
  labelOrder: "rank",
};

export function hfScatterData(board: PublicLeaderboard): ScatterDatum[] {
  return board.rows.map((row) => ({
    key: row.entityKey,
    name: shortModelName(row),
    vendor: row.vendor,
    x: row.extra.downloads ?? null,
    y: row.extra.likes ?? null,
    rank: row.rank,
  }));
}
