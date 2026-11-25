/**
 * 采集侧计价单位共性层(牌价改造 P2):单位标签识别 + 模态→单位单一出处。
 *
 * 收口此前四处各说各话的单位知识:bailian.unitOfTable、volcengine.unitOfTable、
 * siliconflow.SINGLE_UNIT_LABELS、baidu-ciyuansuo.ciyuansuoUnitForModality——
 * 同一份「元/张=per_image」写四遍必然漂移。新源接法:HTML 表格源用
 * `unitOfTableLike`(表头+首行格),单价格行源用 `unitOfLabelText`,
 * 目录型聚合源用 `unitForModality`。
 *
 * 单位闸纪律(批G):认不出 → null,整表/整模型跳过——单位不明的价格
 * 混进比价就是污染(错价比缺价危害大得多)。
 */

/** 单位标签 → 计价单位;次序即优先级(张/秒/分钟在前,token 系殿后) */
const UNIT_LABELS: ReadonlyArray<{ re: RegExp; unit: string }> = [
  { re: /元\s*\/\s*张|每\s*张|每\s*图\s*片|元\s*\/\s*图片/, unit: "per_image" },
  { re: /元\s*\/\s*秒|每\s*秒/, unit: "per_second" },
  { re: /元\s*\/\s*分\s*钟|每\s*分\s*钟/, unit: "per_minute" },
  { re: /每\s*百\s*万\s*Token|元\s*\/\s*M\s*token/i, unit: "per_1m_tokens" },
  { re: /每\s*千\s*Token|元\s*\/\s*K\s*token/i, unit: "per_1k_tokens" },
];

const NON_TOKEN_LABELS = UNIT_LABELS.filter(
  (l) => l.unit !== "per_1m_tokens" && l.unit !== "per_1k_tokens",
);
const TOKEN_LABELS = UNIT_LABELS.filter(
  (l) => l.unit === "per_1m_tokens" || l.unit === "per_1k_tokens",
);

function firstMatch(
  labels: ReadonlyArray<{ re: RegExp; unit: string }>,
  text: string,
): string | null {
  for (const { re, unit } of labels) {
    if (re.test(text)) return unit;
  }
  return null;
}

/** 文本(价格格标签/表头串)→ 计价单位;认不出 null */
export function unitOfLabelText(text: string): string | null {
  return firstMatch(UNIT_LABELS, text);
}

/**
 * 表级单位(bailian 口径序,批G 实探钉死):
 * 表头张/秒/分钟 → 首行数据格张/秒/分钟(「0.02元/张」写在格里的表)→
 * 表头 token 系(「每百万Token」「元/Mtoken」)。headers-only 的源传空数组即可。
 */
export function unitOfTableLike(headers: string[], firstRowCells: string[]): string | null {
  const head = headers.join("").replace(/\s+/g, "");
  const headNonToken = firstMatch(NON_TOKEN_LABELS, head);
  if (headNonToken !== null) return headNonToken;
  const cell = firstRowCells.join("").replace(/\s+/g, "");
  const cellNonToken = firstMatch(NON_TOKEN_LABELS, cell);
  if (cellNonToken !== null) return cellNonToken;
  return firstMatch(TOKEN_LABELS, head);
}

/**
 * 模态 → 行级计价单位(目录型聚合源口径:模态 chip 定单位,不信表格文案)。
 * 中文模态词为词元所实探形态;**音频/图片口径未实证 → null 整模型跳过**
 * (宁可少收不可错收;实证后在此补一行,词元所图片模型即可收入)。
 */
const MODALITY_UNITS: Record<string, string> = {
  文本: "per_1m_tokens",
  视频: "per_second",
};

export function unitForModality(modality: string): string | null {
  return MODALITY_UNITS[modality.trim()] ?? null;
}
