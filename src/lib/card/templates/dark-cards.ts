/**
 * 深色系卡模板(M36 批②):金句/数据/要点——观点与数据的放大器。
 * 版式来自模板库样张验证稿;**加粗** 渲染为蓝紫渐变强调,数据一律取自素材。
 */
import { rich, wrapDocDark } from "./shell";

export type QuoteData = { quote: string; author?: string };
export type StatsData = {
  title?: string;
  items: { value: string; label: string }[];
};
export type PointsData = { title?: string; points: string[] };

export function quoteHtml(d: QuoteData): string {
  const author = d.author
    ? `<div class="src"><span class="dot"></span>—— ${rich(d.author)}</div>`
    : "";
  return wrapDocDark(
    `<div class="badge">💡 博主金句</div>
<div class="mid"><div class="qmark">&ldquo;</div>
<div class="q-text">${rich(d.quote)}</div>${author}</div>`,
    `.mid{position:relative;flex:1;display:flex;flex-direction:column;justify-content:center}
.card{display:flex;flex-direction:column}
.badge{align-self:flex-start}
.qmark{font-size:104px;line-height:.6;color:#6366f1;opacity:.9;font-family:Georgia,serif;margin-top:34px}
.q-text{font-size:42px;font-weight:800;line-height:1.55;margin:26px 0 40px}
.src{display:flex;align-items:center;gap:14px;font-size:22px;color:#94a3b8}
.dot{width:10px;height:10px;border-radius:50%;background:#34d399}`,
  );
}

export function statsHtml(d: StatsData): string {
  const title = d.title
    ? `<div class="badge">${rich(d.title)}</div><div class="grid gap-head">`
    : `<div class="grid">`;
  const cells = d.items
    .map(
      (it) =>
        `<div class="st"><div class="st-v">${rich(it.value)}</div><div class="st-l">${rich(it.label)}</div></div>`,
    )
    .join("");
  return wrapDocDark(
    `${title}${cells}</div>`,
    `.grid{position:relative;display:flex;flex-wrap:wrap;gap:20px;align-content:center;flex:1}
.gap-head{margin-top:36px}
.st{flex:1 1 40%;min-width:280px;padding:34px 30px;border-radius:18px;
background:rgba(148,163,184,.07);border:1px solid rgba(148,163,184,.15)}
.st-v{font-size:64px;font-weight:900;line-height:1.1;
background:linear-gradient(90deg,#60a5fa 0%,#a78bfa 60%,#f472b6 100%);
-webkit-background-clip:text;background-clip:text;color:transparent}
.st-l{font-size:21px;color:#cbd5e1;margin-top:12px}`,
  );
}

export function pointsHtml(d: PointsData): string {
  const head = d.title
    ? `<div class="head"><div class="idx">01</div><div class="t-wrap"><small>方法笔记 · POINTS</small><div class="t">${rich(d.title)}</div></div></div>`
    : `<div class="head"><div class="idx">01</div><div class="t-wrap"><small>方法笔记 · POINTS</small></div></div>`;
  const rows = d.points
    .map(
      (p, i) =>
        `<div class="row"><div class="no">${i + 1}</div><div class="txt">${rich(p)}</div></div>`,
    )
    .join("");
  return wrapDocDark(
    `${head}<div class="rows">${rows}</div>`,
    `.head{display:flex;align-items:center;gap:20px;margin-bottom:30px;position:relative}
.idx{width:62px;height:62px;border-radius:18px;background:linear-gradient(135deg,#4f46e5,#7c3aed);
display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:#fff;
box-shadow:0 8px 24px rgba(79,70,229,.4)}
.t-wrap small{display:block;font-size:16px;color:#818cf8;letter-spacing:3px;margin-bottom:6px}
.t{font-size:33px;font-weight:800}
.rows{position:relative;display:flex;flex-direction:column;gap:14px;flex:1;justify-content:center}
.row{display:flex;gap:16px;padding:20px 24px;border-radius:16px;
background:rgba(148,163,184,.07);border:1px solid rgba(148,163,184,.12)}
.no{flex:none;width:34px;height:34px;border-radius:10px;margin-top:2px;
background:linear-gradient(135deg,#3b82f6,#8b5cf6);font-size:18px;font-weight:700;color:#fff;
display:flex;align-items:center;justify-content:center}
.txt{font-size:22px;line-height:1.7;color:#cbd5e1}`,
  );
}
