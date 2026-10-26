/**
 * 图像/矩阵卡模板(M38 新增,2026-10-18 统一深空重皮):大图卡与并列要素矩阵卡。
 * 大图卡=图源(站内路径)+ 可选大字报标题 + accent 左缘说明条(深空口径:
 * 深框画廊式,阴影加深),为「图文并茂」提供受控图通道(src 走 schema 白名单
 * 校验,渲染管线再改写 file://)。矩阵卡=并列要素网格(2~8 格自动定列),
 * 图标/名目/一句话,盘点类内容的「一图看全」表达。强调色走 accent 变量。
 */
import { ACCENTS, escapeHtml, pickAccent, rich, wrapDocDark, headline } from "./shell";

export type PhotoData = { src: string; title?: string; caption?: string };
export type MatrixData = {
  title?: string;
  cells: { name: string; desc?: string; icon?: string }[];
};

export function photoHtml(d: PhotoData, seed?: string): string {
  const ac = pickAccent(ACCENTS, seed ?? JSON.stringify(d));
  const title = d.title ? headline(d.title, ac) : "";
  const caption = d.caption ? `<div class="cap">${rich(d.caption)}</div>` : "";
  return wrapDocDark(
    `${title}<figure class="ph"><img src="${escapeHtml(d.src)}" alt="${escapeHtml(d.caption ?? d.title ?? "")}"></figure>${caption}`,
    `.title{text-align:center;font-size:36px;font-weight:700;margin-bottom:22px}
.title .hl{padding:2px 12px;border-radius:8px}
.ph{position:relative;border-radius:14px;overflow:hidden;box-shadow:0 12px 34px rgba(0,0,0,.5);
border:1px solid rgba(148,163,184,.16)}
.ph img{display:block;width:100%;max-height:560px;object-fit:cover}
.cap{margin-top:16px;padding:12px 18px;border-left:4px solid var(--ac);background:var(--ac-soft);
border-radius:0 10px 10px 0;font-size:18px;line-height:1.6;color:#cbd5e1}`,
    ac,
  );
}

export function matrixHtml(d: MatrixData, seed?: string): string {
  const ac = pickAccent(ACCENTS, seed ?? JSON.stringify(d));
  // 列数自适应:≤4 格按格数,5~6 格 3 列,7~8 格 4 列(避免单行过挤)
  const cols = d.cells.length <= 4 ? d.cells.length : d.cells.length <= 6 ? 3 : 4;
  const cells = d.cells
    .map((c) => {
      const icon = c.icon ? `<div class="ico">${escapeHtml(c.icon)}</div>` : "";
      const desc = c.desc ? `<div class="d">${rich(c.desc)}</div>` : "";
      return `<div class="cell">${icon}<div class="n">${rich(c.name)}</div>${desc}</div>`;
    })
    .join("");
  const title = d.title ? headline(d.title, ac) : "";
  return wrapDocDark(
    `${title}<div class="mx" style="grid-template-columns:repeat(${cols},1fr)">${cells}</div>`,
    `.title{text-align:center;font-size:38px;font-weight:700;margin-bottom:26px}
.title .hl{padding:2px 12px;border-radius:8px}
.mx{display:grid;gap:14px;flex:1;align-content:center}
.card{display:flex;flex-direction:column}
.cell{background:rgba(148,163,184,.07);border:1.5px solid rgba(148,163,184,.14);border-radius:14px;padding:20px 18px}
.cell:nth-child(even){background:var(--ac-soft);border-color:rgba(148,163,184,.14)}
.ico{width:42px;height:42px;border-radius:10px;background:rgba(11,18,32,.55);border:1px solid rgba(148,163,184,.18);
display:flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:10px}
.n{font-size:20px;font-weight:700;line-height:1.4}
.d{font-size:16px;color:#94a3b8;margin-top:6px;line-height:1.5}`,
    ac,
  );
}
