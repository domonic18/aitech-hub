/**
 * 深色系卡模板(M36 批②建,M38 视觉升级):金句/数据/要点——观点与数据的放大器。
 * M38 修订:accent 按内容确定性轮换;**加粗** 渲染为荧光笔底(与浅色系同语言);
 * stats 首条自动放大为主指标 + 可选涨跌 delta(▲绿▼红);points 条目支持可选
 * icon(emoji),撤「编号徽章+眉标」(编号只用于真序列,M38 反模板腔口径);
 * 数字一律 tabular-nums,大字用中等字重(越大越轻)。
 */
import { ACCENTS_DARK, escapeHtml, pickAccent, rich, wrapDocDark } from "./shell";

export type QuoteData = { quote: string; author?: string };
export type StatsData = {
  title?: string;
  items: { value: string; label: string; delta?: string }[];
};
export type PointsData = { title?: string; points: { text: string; icon?: string }[] };

export function quoteHtml(d: QuoteData): string {
  const ac = pickAccent(ACCENTS_DARK, JSON.stringify(d));
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
.qmark{font-size:88px;line-height:.6;color:var(--ac);opacity:.9;font-family:Georgia,serif;margin-top:34px}
.q-text{font-size:42px;font-weight:700;line-height:1.55;margin:26px 0 40px}
.src{display:flex;align-items:center;gap:14px;font-size:22px;color:#94a3b8}
.dot{width:10px;height:10px;border-radius:50%;background:var(--ac)}`,
    ac,
  );
}

/** delta 着色:负向( Leading -/▼/↓ 或含「降」)红,其余绿 */
function deltaPill(delta: string): string {
  const neg = /^[-▼↓]/.test(delta) || delta.includes("降");
  const arrow = /^[+\-▲▼↑↓]/.test(delta) ? "" : neg ? "▼" : "▲";
  return `<span class="delta" style="color:${neg ? "#f87171" : "#34d399"}">${escapeHtml(arrow + delta)}</span>`;
}

export function statsHtml(d: StatsData): string {
  const ac = pickAccent(ACCENTS_DARK, JSON.stringify(d));
  const [hero, ...rest] = d.items;
  const title = d.title
    ? `<div class="badge">${rich(d.title)}</div><div class="grid gap-head">`
    : `<div class="grid">`;
  const heroCell = `<div class="hero"><div class="h-row"><span class="h-v">${rich(hero.value)}</span>${
    hero.delta ? deltaPill(hero.delta) : ""
  }</div><div class="h-l">${rich(hero.label)}</div></div>`;
  const cells = rest
    .map(
      (it) =>
        `<div class="st"><div class="st-v">${rich(it.value)}</div>${
          it.delta ? `<div class="st-d">${deltaPill(it.delta)}</div>` : ""
        }<div class="st-l">${rich(it.label)}</div></div>`,
    )
    .join("");
  return wrapDocDark(
    `${title}${heroCell}${cells}</div>`,
    `.grid{position:relative;display:flex;flex-wrap:wrap;gap:20px;align-content:center;flex:1}
.gap-head{margin-top:36px}
.hero{flex:1 1 100%;padding:30px 34px;border-radius:16px;
background:var(--ac-soft);border:1px solid var(--ac-soft)}
.h-row{display:flex;align-items:baseline;gap:18px}
.h-v{font-size:76px;font-weight:700;line-height:1.05;color:#fff;font-variant-numeric:tabular-nums}
.delta{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums}
.h-l{font-size:23px;color:#e2e8f0;margin-top:10px}
.st{flex:1 1 40%;min-width:280px;padding:26px 30px;border-radius:14px;
background:rgba(148,163,184,.07);border:1px solid rgba(148,163,184,.15)}
.st-v{font-size:40px;font-weight:700;line-height:1.15;color:var(--ac-text);font-variant-numeric:tabular-nums}
.st-d{font-size:19px;font-weight:700;margin-top:4px}
.st-d .delta{font-size:19px}
.st-l{font-size:21px;color:#cbd5e1;margin-top:10px}`,
    ac,
  );
}

export function pointsHtml(d: PointsData): string {
  const ac = pickAccent(ACCENTS_DARK, JSON.stringify(d));
  const head = d.title ? `<div class="head"><div class="t">${rich(d.title)}</div></div>` : "";
  const rows = d.points
    .map((p) => {
      const marker = p.icon
        ? `<div class="ico">${escapeHtml(p.icon)}</div>`
        : `<div class="mk"></div>`;
      return `<div class="row">${marker}<div class="txt">${rich(p.text)}</div></div>`;
    })
    .join("");
  return wrapDocDark(
    `${head}<div class="rows">${rows}</div>`,
    `.head{display:flex;align-items:center;margin-bottom:28px;position:relative}
.t{font-size:31px;font-weight:700;position:relative;padding-left:22px}
.t::before{content:"";position:absolute;left:0;top:12px;width:14px;height:14px;border-radius:4px;background:var(--ac)}
.rows{position:relative;display:flex;flex-direction:column;gap:14px;flex:1;justify-content:center}
.row{display:flex;gap:16px;padding:20px 24px;border-radius:14px;align-items:flex-start;
background:rgba(148,163,184,.07);border:1px solid rgba(148,163,184,.12)}
.mk{flex:none;width:12px;height:12px;border-radius:4px;background:var(--ac);margin-top:15px}
.ico{flex:none;width:40px;height:40px;border-radius:10px;background:var(--ac-soft);
display:flex;align-items:center;justify-content:center;font-size:21px}
.txt{font-size:22px;line-height:1.7;color:#cbd5e1}`,
    ac,
  );
}
