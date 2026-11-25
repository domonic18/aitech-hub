/**
 * 表头列语义映射框架(牌价改造 P2):把「表头关键词 → 列角色」从各源解析器
 * 的私有 if 链抽成声明式规则表——新 HTML 表格源只声明关键词表,不再重写映射。
 *
 * 规则按序扫描先命中先赢(次序即优先级,combined 这类复合列必须排在
 * 输入/输出之前,否则被窄词截胡)。百炼方言见 BAILIAN_COLUMN_RULES,
 * 与其原 colRoleIf 行为等价(fixture 测试钉死)。
 */

/** 列角色(表格 → 记录字段的语义) */
export type ColumnRole =
  | "model"
  | "scope"
  | "mode"
  | "tokenRange"
  | "cond"
  | "combined"
  | "input"
  | "cache"
  | "output"
  | "free";

/** 表头 → 列角色;命中规则表即返回,认不出 null(该列不收) */
export function roleByKeywords(
  header: string,
  rules: ReadonlyArray<{ role: ColumnRole; re: RegExp }>,
): ColumnRole | null {
  const h = header.replace(/\s+/g, "");
  for (const { role, re } of rules) {
    if (re.test(h)) return role;
  }
  return null;
}

/** 百炼方言(次序敏感:combined 在输入/输出前;「视频类型/参考类型」归 cond) */
export const BAILIAN_COLUMN_RULES: ReadonlyArray<{ role: ColumnRole; re: RegExp }> = [
  { role: "model", re: /模型ID/ },
  { role: "scope", re: /服务部署范围/ },
  { role: "mode", re: /^模式/ },
  { role: "tokenRange", re: /Token数|Token范围/ },
  { role: "free", re: /免费额度/ },
  { role: "cond", re: /分辨率|视频类型|参考类型/ },
  { role: "combined", re: /输入和输出/ },
  { role: "cache", re: /缓存命中/ },
  { role: "input", re: /输入单价/ },
  { role: "output", re: /输出单价/ },
];
