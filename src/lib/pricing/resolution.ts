/**
 * 分辨率口径(M77):文生图/文生视频的价格随分辨率分档,行上只挂一个基准价,
 * 必须让用户看到「这个价对应哪个分辨率」。
 *
 * 两个口径:
 * - `resolutionOf`:从档位标签取分辨率原文(展示用)。取标签**末段**——方舟图片表
 *   的标签是「场景组·分辨率」(如「单图生成场景·P ≤ 2.61M」),末段才是分辨率。
 * - `resolutionRank`:分辨率大小序(行价基准取最低档=入口价)。K 族按边长折算
 *   (1k=1024、2k=2048),P 族按高度(480P=480),「宽×高」按长边;同模型同表内
 *   只在同族比较,跨族序为近似(768P 与 2K 的相对大小按直觉)。
 */

/** 标签末段(档位标签是「部署范围·模式·维度」,分辨率在末段) */
function tailOf(label: string): string {
  const t = label.trim();
  if (t === "") return "";
  return (t.includes("·") ? t.slice(t.lastIndexOf("·") + 1) : t).trim();
}

/** 档位标签里的分辨率原文;不是分辨率标签 → null */
export function resolutionOf(label: string): string | null {
  const tail = tailOf(label);
  if (/^\d+\s*[kK]$/.test(tail)) return tail;
  if (/^\d+\s*[pP]$/.test(tail)) return tail;
  if (/^\d+\s*[×xX*]\s*\d+/.test(tail)) return tail;
  // 方舟像素档(如「P ≤ 2.61M」「2.61M < P ≤ 4.63M」)
  if (/[<>≤≥]/.test(tail) && /[MP]/.test(tail)) return tail;
  return null;
}

/** 分辨率大小序;非分辨率文本 → null(取末段——标签可能是「有声视频·720P」) */
export function resolutionRank(label: string | null): number | null {
  if (label === null) return null;
  const t = tailOf(label);
  const k = /^(\d+)\s*[kK]$/.exec(t);
  if (k !== null) return Number(k[1]) * 1024;
  const p = /^(\d+)\s*[pP]$/.exec(t);
  if (p !== null) return Number(p[1]);
  const xy = /^(\d+)\s*[×xX*]\s*(\d+)/.exec(t);
  if (xy !== null) return Math.max(Number(xy[1]), Number(xy[2]));
  // 方舟像素档(如「P ≤ 2.61M」「2.61M < P ≤ 4.63M」):取最大像素数(单位 M)
  const px = [...t.matchAll(/([\d.]+)\s*M/g)];
  if (px.length > 0) return Math.max(...px.map((m) => Number(m[1])));
  return null;
}

/**
 * 档位上生效的分辨率:DB 显式参数优先,空则按标签兜底解析。
 */
export function tierResolution(tier: {
  tierLabel: string;
  params?: { resolution?: string | null } | null;
}): string | null {
  return tier.params?.resolution ?? resolutionOf(tier.tierLabel);
}

/**
 * 行价对应的分辨率:价格与行价相等的档位里,取**分辨率最低**的那档。
 *
 * 为什么不取「第一档」:档位在库里的排序是档位名(「2k」排在「全球·1k」前),
 * 第一档未必是行价基准档;同价时取最低分辨率才与采集侧「行价=入口价」口径一致。
 */
export function rowResolution(row: {
  outputPrice: number | null;
  tiers: ReadonlyArray<{
    tierLabel: string;
    outputPrice: number | null;
    params?: { resolution?: string | null } | null;
  }>;
}): string | null {
  if (row.outputPrice === null) return null;
  const same = row.tiers.filter((t) => t.outputPrice !== null && t.outputPrice === row.outputPrice);
  const withRes = same.filter((t) => tierResolution(t) !== null);
  if (withRes.length === 0) return null;
  const best = withRes.reduce((a, b) => {
    const ar = resolutionRank(tierResolution(a));
    const br = resolutionRank(tierResolution(b));
    if (ar === null) return b;
    if (br === null) return a;
    return br < ar ? b : a;
  });
  return tierResolution(best);
}
