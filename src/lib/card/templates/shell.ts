/**
 * 卡片模板公共壳(M36 批②):双主题文档壳 + 文本工具。
 * - dark(深空蓝紫系)= 观点/数据:金句、数据、要点;
 * - light(马卡龙浅色系)= 流程/方法:步骤、对比、时间线、泳道全景。
 * 视觉语法取自 2026 公众号/短视频图文主流:大字报标题+荧光笔高亮、色块
 * 编码语义、编号导航、兜底摘要条;全文同色系不混彩(调研铁律)。
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

/** 富文本口径:先转义再解析 **加粗** 标记为渐变强调 <em>(agent 侧约定写法) */
export function rich(s: string): string {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<em>$1</em>");
}

const FONT_STACK = '"Noto Sans CJK SC","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';

/** 深色系壳:深空蓝紫渐变卡面,发光斑点缀 */
export function wrapDocDark(body: string, extraCss = ""): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
body{width:900px;font-family:${FONT_STACK};line-height:1.6}
.card{position:relative;overflow:hidden;min-height:600px;border-radius:24px;
background:linear-gradient(135deg,#0b1220 0%,#141d33 55%,#1a1440 100%);padding:60px 68px 52px;color:#f1f5f9}
.glow{position:absolute;width:460px;height:460px;border-radius:50%;filter:blur(100px)}
.g1{background:#4f46e5;top:-170px;right:-130px;opacity:.30}
.g2{background:#0ea5e9;bottom:-210px;left:-150px;opacity:.20}
.badge{display:inline-block;font-size:19px;letter-spacing:4px;color:#818cf8;
border:1px solid rgba(129,140,248,.45);border-radius:999px;padding:8px 24px;position:relative}
em{font-style:normal;background:linear-gradient(90deg,#60a5fa,#c084fc);
-webkit-background-clip:text;background-clip:text;color:transparent}
${extraCss}
</style></head><body><div class="card"><div class="glow g1"></div><div class="glow g2"></div>${body}</div></body></html>`;
}

/** 浅色系壳:白底大字报卡面(标题高亮由各模板自定色) */
export function wrapDocLight(body: string, extraCss = ""): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
body{width:900px;font-family:${FONT_STACK};line-height:1.6;color:#1f2328}
.card{position:relative;min-height:600px;border-radius:24px;background:#fff;padding:44px 40px 34px}
em{font-style:normal;color:#4f46e5;font-weight:700}
${extraCss}
</style></head><body><div class="card">${body}</div></body></html>`;
}
