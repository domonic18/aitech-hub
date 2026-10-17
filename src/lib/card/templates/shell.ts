/**
 * 卡片模板公共壳(M36 批②建,M38 视觉升级):双主题文档壳 + accent 令牌 + 文本工具。
 * - dark(深空蓝紫系)= 观点/数据:金句、数据、要点、量级条、台账;
 * - light(马卡龙浅色系)= 流程/方法:步骤、对比、时间线、泳道全景、矩阵、图片。
 * M38 反模板腔修订(frontend-design 校准清单):撤双发光斑(渐变色块当装饰是
 * 生成味第一大 tell),换单装饰器(顶部 accent 短线 + 一枚弱化圆环);**强调**
 * 从渐变文字改为荧光笔底(「标题里挑一个词做渐变强调」是点名 tell,荧光笔
 * 与浅色系同一视觉语言);眉标撤 4px 字距的 ALL-CAPS 风;字号遵循「越大越轻」。
 * accent 三组按卡片内容摘要确定性轮换(同数据恒同色,重渲染不跳变),破「每篇同款」。
 * min-height:600px 为硬性口径——渲染器 fullPage 截图有 600px 视口下限
 * (scrollHeight=max(内容,600)),矮卡不设下限会底部露白带(实测复现)。
 */

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** 富文本口径:先转义再解析 **加粗** 标记为荧光笔强调 <em>(agent 侧约定写法) */
export function rich(s: string): string {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<em>$1</em>");
}

const FONT_STACK = '"Noto Sans CJK SC","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';

/** 深色系 accent 组(主形状色/荧光笔底/强调字色,均保证深底可读) */
export type DarkAccent = { main: string; soft: string; text: string };
export const ACCENTS_DARK: readonly DarkAccent[] = [
  { main: "#38bdf8", soft: "rgba(56,189,248,.16)", text: "#7dd3fc" }, // 天青
  { main: "#a78bfa", soft: "rgba(167,139,250,.16)", text: "#c4b5fd" }, // 紫罗兰
  { main: "#34d399", soft: "rgba(52,211,153,.14)", text: "#6ee7b7" }, // 翠绿
];

/** 浅色系 accent 组(主色/荧光笔底/浅底色块) */
export type LightAccent = { main: string; hl: string; soft: string };
export const ACCENTS_LIGHT: readonly LightAccent[] = [
  { main: "#4f46e5", hl: "#c7d2fe", soft: "#eef2ff" }, // 靛蓝
  { main: "#0d9488", hl: "#99f6e4", soft: "#f0fdfa" }, // 青碧
  { main: "#e11d48", hl: "#fecdd3", soft: "#fff1f2" }, // 绯红
];

/** 确定性轮换:内容摘要 → 固定一组 accent(同数据恒同色) */
export function pickAccent<T>(palette: readonly T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i) * (i + 7)) % 997;
  return palette[h % palette.length];
}

/** 深色系壳:深空渐变卡面,单装饰器(顶部 accent 短线 + 弱圆环),accent 走 CSS 变量 */
export function wrapDocDark(
  body: string,
  extraCss = "",
  accent: DarkAccent = ACCENTS_DARK[0],
): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
body{width:900px;background:#0b1220;font-family:${FONT_STACK};line-height:1.6}
.card{--ac:${accent.main};--ac-soft:${accent.soft};--ac-text:${accent.text};
position:relative;overflow:hidden;min-height:600px;border-radius:20px;
background:linear-gradient(135deg,#0b1220 0%,#131b2e 55%,#161233 100%);padding:60px 68px 52px;color:#f1f5f9}
.ac-line{position:absolute;top:0;left:0;width:120px;height:5px;background:var(--ac);border-radius:0 0 4px 0}
.ring{position:absolute;width:360px;height:360px;border:1px solid var(--ac);border-radius:50%;top:-190px;right:-150px;opacity:.14}
.badge{display:inline-block;font-size:19px;color:var(--ac-text);background:var(--ac-soft);
border:1px solid var(--ac-soft);border-radius:999px;padding:8px 22px;position:relative}
em{font-style:normal;background:var(--ac-soft);color:var(--ac-text);border-radius:5px;
padding:1px 6px;font-weight:600;-webkit-box-decoration-break:clone;box-decoration-break:clone}
${extraCss}
</style></head><body><div class="card"><div class="ac-line"></div><div class="ring"></div>${body}</div></body></html>`;
}

/** 浅色系壳:白底大字报卡面(荧光笔高亮色随 accent 组) */
export function wrapDocLight(
  body: string,
  extraCss = "",
  accent: LightAccent = ACCENTS_LIGHT[0],
): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
body{width:900px;font-family:${FONT_STACK};line-height:1.6;color:#1f2328}
.card{--ac:${accent.main};--ac-hl:${accent.hl};--ac-soft:${accent.soft};
position:relative;min-height:600px;border-radius:20px;background:#fff;padding:44px 40px 34px}
em{font-style:normal;color:var(--ac);font-weight:700}
${extraCss}
</style></head><body><div class="card">${body}</div></body></html>`;
}
