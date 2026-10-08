/**
 * 用量看板展示口径(M14 批⑦):数字/费用/tokens 缩写与角色标签-配色映射。
 * 纯函数无状态,RSC 页与子组件共用;与原型 admin-usage.html 的角色 tag 四色对齐。
 */

/** 整数千分位(12,284) */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** tokens 缩写(48.2M / 612.4K / 980;1 位小数,M=百万与供应商牌价口径一致) */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

/** 费用(¥124.30;小于 ¥0.01 且非零时保留 3 位,免全 0.00) */
export function fmtCost(n: number): string {
  if (n > 0 && n < 0.01) return `¥${n.toFixed(3)}`;
  return `¥${n.toFixed(2)}`;
}

/** 时长缩写(36.5h;按原型的 1 位小数) */
export function fmtHours(sec: number): string {
  return `${(sec / 3600).toFixed(1)}h`;
}

/** 角色 tag:标签 + 配色(原型 use-core=accent / use-agent=green / use-cover=amber /
 * use-vis=blue;asr/seo 归 blue 桶,四色不新增变量) */
export function usageRoleMeta(role: string): { label: string; cls: string } {
  switch (role) {
    case "interpret":
      return { label: "电报解读", cls: "text-accent border-accent/35 bg-accent/10" };
    case "summarize":
      return { label: "文字摘要", cls: "text-accent border-accent/35 bg-accent/10" };
    case "search":
      return { label: "Agent 搜索", cls: "text-green border-green/35 bg-green/10" };
    case "cover":
      return { label: "封面生图", cls: "text-amber border-amber/35 bg-amber/10" };
    case "asr":
      return { label: "ASR 转写", cls: "text-blue border-blue/35 bg-blue/10" };
    case "seo":
      return { label: "SEO 补全", cls: "text-blue border-blue/35 bg-blue/10" };
    default:
      return { label: role, cls: "text-text-2 border-line bg-panel-2" };
  }
}
