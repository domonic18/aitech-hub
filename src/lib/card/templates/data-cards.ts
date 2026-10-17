/**
 * 数据可视化卡模板(M38 新增,深色系):横条量级条形卡与键值台账卡。
 * 纯 CSS 可视化(条形=div 宽度百分比,台账=点线引导行),零图片依赖——
 * 「图文并茂」的第一性是版面可视化,不是贴图。数字 tabular-nums 对齐。
 */
import { ACCENTS_DARK, pickAccent, rich, wrapDocDark } from "./shell";

export type BarsData = {
  title?: string;
  unit?: string;
  items: { label: string; pct: number; value: string }[];
};
export type LedgerData = {
  title?: string;
  rows: { k: string; v: string }[];
};

/** 横条量级卡:pct 为相对刻度 1~100(模板只表达相对大小,精确值看 value 文本) */
export function barsHtml(d: BarsData): string {
  const ac = pickAccent(ACCENTS_DARK, JSON.stringify(d));
  const head = d.title
    ? `<div class="head"><div class="badge">${rich(d.title)}</div>${
        d.unit ? `<span class="unit">刻度:${rich(d.unit)}</span>` : ""
      }</div>`
    : "";
  const rows = d.items
    .map(
      (it) =>
        `<div class="row"><div class="bl">${rich(it.label)}</div><div class="track"><div class="fill" style="width:${it.pct}%"></div></div><div class="bv">${rich(it.value)}</div></div>`,
    )
    .join("");
  return wrapDocDark(
    `${head}<div class="bars">${rows}</div>`,
    `.head{display:flex;align-items:center;gap:16px;margin-bottom:30px;position:relative}
.badge{align-self:flex-start}
.unit{font-size:17px;color:#94a3b8}
.bars{position:relative;display:flex;flex-direction:column;gap:22px;flex:1;justify-content:center}
.row{display:grid;grid-template-columns:190px 1fr 130px;align-items:center;gap:18px}
.bl{font-size:21px;color:#cbd5e1;text-align:right;line-height:1.4}
.track{height:26px;border-radius:8px;background:rgba(148,163,184,.12);overflow:hidden}
.fill{height:100%;border-radius:8px;background:var(--ac);opacity:.92}
.bv{font-size:23px;font-weight:700;color:#f1f5f9;font-variant-numeric:tabular-nums}`,
    ac,
  );
}

/** 键值台账卡:规格参数/配置清单速览,点线引导行(杂志账本版式) */
export function ledgerHtml(d: LedgerData): string {
  const ac = pickAccent(ACCENTS_DARK, JSON.stringify(d));
  const head = d.title ? `<div class="badge">${rich(d.title)}</div>` : "";
  const rows = d.rows
    .map(
      (r) =>
        `<div class="row"><span class="k">${rich(r.k)}</span><span class="lead"></span><span class="v">${rich(r.v)}</span></div>`,
    )
    .join("");
  return wrapDocDark(
    `${head}<div class="ledger">${rows}</div>`,
    `.badge{position:relative}
.ledger{position:relative;display:flex;flex-direction:column;justify-content:center;flex:1}
.row{display:flex;align-items:baseline;gap:12px;padding:13px 0;border-bottom:1px solid rgba(148,163,184,.10)}
.row:last-child{border-bottom:none}
.k{font-size:20px;color:#94a3b8;flex:none}
.lead{flex:1;border-bottom:1px dotted rgba(148,163,184,.30);transform:translateY(-6px);min-width:24px}
.v{font-size:21px;font-weight:700;color:#f1f5f9;text-align:right;font-variant-numeric:tabular-nums}`,
    ac,
  );
}
