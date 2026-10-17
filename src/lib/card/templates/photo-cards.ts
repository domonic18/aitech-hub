/**
 * 图像/矩阵卡模板(M38 新增,浅色系):大图卡与并列要素矩阵卡。
 * 大图卡=图源(站内路径)+ 可选大字报标题 + accent 左缘说明条,为「图文并茂」
 * 提供受控图通道(src 走 schema 白名单校验,渲染管线再改写 file://)。
 * 矩阵卡=并列要素网格(2~8 格自动定列),图标/名目/一句话,盘点类内容的
 * 「一图看全」表达。强调色走 accent 变量,单一强调不混彩。
 */
import { ACCENTS_LIGHT, escapeHtml, pickAccent, rich, wrapDocLight } from "./shell";

export type PhotoData = { src: string; title?: string; caption?: string };
export type MatrixData = {
  title?: string;
  cells: { name: string; desc?: string; icon?: string }[];
};

/** 大字报标题(浅色系共用样式;photo/matrix 无 headline() 依赖故内联同款) */
function bigTitle(title: string, hl: string): string {
  return `<div class="title"><span class="hl" style="background:linear-gradient(transparent 55%,${hl} 55%)">${rich(title)}</span></div>`;
}

export function photoHtml(d: PhotoData): string {
  const ac = pickAccent(ACCENTS_LIGHT, JSON.stringify(d));
  const title = d.title ? bigTitle(d.title, ac.hl) : "";
  const caption = d.caption ? `<div class="cap">${rich(d.caption)}</div>` : "";
  return wrapDocLight(
    `${title}<figure class="ph"><img src="${escapeHtml(d.src)}" alt="${escapeHtml(d.caption ?? d.title ?? "")}"></figure>${caption}`,
    `.title{text-align:center;font-size:38px;font-weight:700;margin-bottom:22px}
.hl{padding:0 6px}
.ph{position:relative;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,.12)}
.ph img{display:block;width:100%;max-height:560px;object-fit:cover}
.cap{margin-top:16px;padding:12px 18px;border-left:4px solid var(--ac);background:var(--ac-soft);
border-radius:0 10px 10px 0;font-size:18px;line-height:1.6;color:#374151}`,
    ac,
  );
}

export function matrixHtml(d: MatrixData): string {
  const ac = pickAccent(ACCENTS_LIGHT, JSON.stringify(d));
  // 列数自适应:≤4 格按格数,5~6 格 3 列,7~8 格 4 列(避免单行过挤)
  const cols = d.cells.length <= 4 ? d.cells.length : d.cells.length <= 6 ? 3 : 4;
  const cells = d.cells
    .map((c) => {
      const icon = c.icon ? `<div class="ico">${escapeHtml(c.icon)}</div>` : "";
      const desc = c.desc ? `<div class="d">${rich(c.desc)}</div>` : "";
      return `<div class="cell">${icon}<div class="n">${rich(c.name)}</div>${desc}</div>`;
    })
    .join("");
  const title = d.title ? bigTitle(d.title, ac.hl) : "";
  return wrapDocLight(
    `${title}<div class="mx" style="grid-template-columns:repeat(${cols},1fr)">${cells}</div>`,
    `.title{text-align:center;font-size:40px;font-weight:700;margin-bottom:26px}
.hl{padding:0 6px}
.mx{display:grid;gap:14px;flex:1;align-content:center}
.card{display:flex;flex-direction:column}
.cell{background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:14px;padding:20px 18px}
.cell:nth-child(even){background:var(--ac-soft);border-color:var(--ac-hl)}
.ico{width:42px;height:42px;border-radius:10px;background:#fff;border:1px solid #e2e8f0;
display:flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:10px}
.n{font-size:20px;font-weight:700;line-height:1.4}
.d{font-size:16px;color:#6b7280;margin-top:6px;line-height:1.5}`,
    ac,
  );
}
