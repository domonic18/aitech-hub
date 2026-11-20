/**
 * 方舟图片/视频类表的「多档价格格」解析(2026-11-20 实探补)。
 *
 * 图片表的生成价格不是单个数,而是按像素/场景分档(实探 2026-11-20):
 * - doubao-seedream-5-5 输出格 = "P ≤ 2.61M：0.13" + "2.61M < P ≤ 4.63M：0.23"
 *   (P = 单张输出图总像素;两档价不同)
 * - doubao-seedream-5-0-pro 按生图场景区分定价:输出格 = 场景分组
 *   ("单图生成场景：" / "图层拆分场景：") x 像素档(各两档)
 * - 输入格也可能是「首张免费」+「第 2 张起：0.02」两段
 *
 * 格内各段以零宽字符(U+200B)分隔(渲染后的表格 DOM 如此),不是换行。
 * 原解析只认整格纯数字 → 这类行取不到价(落 null),像素口径也全丢。
 *
 * 口径:只认「标签:数字」与纯数字两种形态;认不出的段丢弃(不臆测价格)。
 */

/** 一条价格档(分组 + 档位标签 + 价) */
export interface PriceEntry {
  /** 场景分组(如「单图生成场景」);null=该格无分组 */
  group: string | null;
  /** 档位原文(如「P ≤ 2.61M」「第 2 张起」);null=整格一个价 */
  label: string | null;
  price: number;
}

/** 格内分段(零宽字符/换行都是分隔符) */
function segmentsOf(text: string): string[] {
  return text
    .split(/[\u200b\n]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * 价格格 → 价格档序列(纯函数,单测锚)。
 * 形态:纯数字 / 「标签：数字」/ 「分组：」(仅换组)/ 「…免费」(价 0)。
 */
export function parsePriceEntries(text: string): PriceEntry[] {
  const entries: PriceEntry[] = [];
  let group: string | null = null;
  for (const seg of segmentsOf(text)) {
    const pure = /^([\d.]+)$/.exec(seg);
    if (pure !== null) {
      entries.push({ group, label: null, price: Number(pure[1]) });
      continue;
    }
    const labelled = /^(.+?)\s*[:：]\s*([\d.]+)$/.exec(seg);
    if (labelled !== null) {
      entries.push({ group, label: labelled[1]!.trim(), price: Number(labelled[2]) });
      continue;
    }
    const header = /^(.+?)\s*[:：]$/.exec(seg);
    if (header !== null) {
      group = header[1]!.trim();
      continue;
    }
    // 「首张免费」「免费」:价 0(免费是明确口径,不是「未公布」)
    if (/免费/.test(seg)) {
      entries.push({ group, label: seg, price: 0 });
      continue;
    }
    // 其余形态(无价文字)丢弃:宁可少收不可错收
  }
  return entries;
}

/** 档位标签(分组 · 档位);无任何标签时为「默认」 */
export function entryTierLabel(e: PriceEntry): string {
  const parts = [e.group, e.label].filter((v): v is string => v !== null && v !== "");
  return parts.length === 0 ? "默认" : parts.join("·");
}

/** 像素档标签(「P ≤ 2.61M」「2.61M < P ≤ 4.63M」这类) */
function isPixelBracket(label: string | null): boolean {
  return label !== null && /(P\s*[<≤>]|M\s*[<≤>])/.test(label);
}

/**
 * 行价基准档(纯函数,单测锚):代表「标准用法 + 最低档」。
 * - 免促销段(「首张免费」)不参与:行价是常态价,不是一次性优惠
 * - 有像素档时取第一个像素档(低像素档=入口价)
 * - 否则取第一条有价档
 */
export function pickBaseEntry(entries: PriceEntry[]): PriceEntry | null {
  const priced = entries.filter((e) => Number.isFinite(e.price));
  const nonPromo = priced.filter((e) => !/免费/.test(e.label ?? ""));
  const pool = nonPromo.length > 0 ? nonPromo : priced;
  if (pool.length === 0) return null;
  const bracket = pool.find((e) => isPixelBracket(e.label));
  return bracket ?? pool[0]!;
}
