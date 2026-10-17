/**
 * 结构卡模板(M36 批②建,原名 light-cards.ts;2026-10-18 统一深空重皮并更名):
 * 步骤/对比/时间线——流程与结构的表达。
 * 深空重皮口径:面板=灰蓝半透明底+细描边,正文 #f1f5f9/#cbd5e1/#94a3b8 三档,
 * 大字报标题=accent 软底荧光笔;对比卡两侧蓝/琥珀为语义对垒色(编码对立关系,
 * 信息非装饰)保留为深底透明版;编号节点保留(真序列,编号编码信息)。
 */
import { ACCENTS, pickAccent, rich, wrapDocDark, headline } from "./shell";

export type StepsData = {
  title?: string;
  steps: { title: string; detail?: string }[];
};
export type CompareData = {
  title?: string;
  left: { label: string; items: string[] };
  right: { label: string; items: string[] };
  verdict?: string;
};
export type TimelineData = {
  title?: string;
  events: { time: string; text: string }[];
  summary?: string;
};

export function stepsHtml(d: StepsData, seed?: string): string {
  const ac = pickAccent(ACCENTS, seed ?? JSON.stringify(d));
  const items = d.steps
    .map(
      (s, i) =>
        `<li><span class="no">${i + 1}</span><div class="li-body"><div class="st">${rich(s.title)}</div>${
          s.detail ? `<div class="sd">${rich(s.detail)}</div>` : ""
        }</div></li>`,
    )
    .join("");
  return wrapDocDark(
    `${d.title ? headline(d.title, ac) : ""}<ol class="sp">${items}</ol>`,
    `.title{text-align:center;font-size:40px;font-weight:700;margin-bottom:30px}
.title .hl{padding:2px 12px;border-radius:8px}
.sp{list-style:none;position:relative}
.sp::before{content:"";position:absolute;left:23px;top:14px;bottom:14px;width:2px;background:rgba(148,163,184,.22)}
.sp li{position:relative;display:flex;gap:20px;padding:13px 0}
.no{flex:none;width:46px;height:46px;border-radius:50%;z-index:1;
background:var(--ac);color:#0b1220;font-size:22px;font-weight:700;
display:flex;align-items:center;justify-content:center}
.li-body{padding-top:4px}
.st{font-size:26px;font-weight:700}
.sd{font-size:19px;color:#94a3b8;margin-top:4px}`,
    ac,
  );
}

export function compareHtml(d: CompareData, seed?: string): string {
  const ac = pickAccent(ACCENTS, seed ?? JSON.stringify(d));
  const col = (side: CompareData["left"], cls: string) =>
    `<div class="cp-col ${cls}"><div class="cp-head">${rich(side.label)}</div><ul>${side.items
      .map((i) => `<li>${rich(i)}</li>`)
      .join("")}</ul></div>`;
  const verdict = d.verdict
    ? `<div class="verdict"><div class="ic">✓</div><p><b>结论</b>&nbsp;|&nbsp;${rich(d.verdict)}</p></div>`
    : "";
  return wrapDocDark(
    `${d.title ? headline(d.title, ac) : ""}<div class="cp">${col(d.left, "cp-l")}
<div class="vs"><div class="vsbadge">VS</div></div>
${col(d.right, "cp-r")}</div>${verdict}`,
    `.title{text-align:center;font-size:40px;font-weight:700;margin-bottom:28px}
.title .hl{padding:2px 12px;border-radius:8px}
.cp{display:grid;grid-template-columns:1fr 64px 1fr;align-items:center}
.cp-col{border-radius:18px;padding:26px 28px}
.cp-l{background:rgba(59,130,246,.10);border:1.5px solid rgba(59,130,246,.32)}
.cp-r{background:rgba(245,158,11,.08);border:1.5px solid rgba(245,158,11,.32)}
.cp-head{font-size:26px;font-weight:700;text-align:center;margin-bottom:14px}
.cp-l .cp-head{color:#93c5fd}.cp-r .cp-head{color:#fcd34d}
.cp-col ul{list-style:none}
.cp-col li{position:relative;padding:8px 0 8px 30px;font-size:20px;line-height:1.6;color:#e2e8f0}
.cp-col li::before{content:"·";position:absolute;left:8px;font-weight:800;font-size:28px;line-height:1}
.cp-l li::before{color:#60a5fa}.cp-r li::before{color:#fbbf24}
.vs{display:flex;align-items:center;justify-content:center}
.vsbadge{width:56px;height:56px;border-radius:50%;background:#f1f5f9;color:#0b1220;font-size:21px;
font-weight:700;display:flex;align-items:center;justify-content:center}
.verdict{display:flex;align-items:center;gap:12px;background:var(--ac-soft);border:1px solid var(--ac-soft);
border-radius:12px;padding:14px 18px;margin-top:22px}
.verdict .ic{flex:none;width:34px;height:34px;border-radius:50%;background:var(--ac);color:#0b1220;
display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:700}
.verdict p{font-size:17px;line-height:1.6;color:#cbd5e1}
.verdict b{color:var(--ac-text)}`,
    ac,
  );
}

export function timelineHtml(d: TimelineData, seed?: string): string {
  const ac = pickAccent(ACCENTS, seed ?? JSON.stringify(d));
  const items = d.events
    .map(
      (e, i) =>
        `<li><span class="dot">${i + 1}</span><div class="ev"><span class="tm">${rich(e.time)}</span><span class="tx">${rich(e.text)}</span></div></li>`,
    )
    .join("");
  const summary = d.summary
    ? `<div class="tldr"><span class="bulb">💡</span><p><b>一眼看懂</b>&nbsp;|&nbsp;${rich(d.summary)}</p></div>`
    : "";
  return wrapDocDark(
    `${d.title ? headline(d.title, ac) : ""}<ol class="tl">${items}</ol>${summary}`,
    `.title{text-align:center;font-size:40px;font-weight:700;margin-bottom:30px}
.title .hl{padding:2px 12px;border-radius:8px}
.tl{list-style:none;position:relative}
.tl::before{content:"";position:absolute;left:20px;top:12px;bottom:12px;width:2px;background:rgba(148,163,184,.22)}
.tl li{position:relative;display:flex;gap:18px;padding:11px 0;align-items:flex-start}
.dot{flex:none;width:40px;height:40px;border-radius:50%;z-index:1;color:#0b1220;font-size:18px;font-weight:700;
background:var(--ac);display:flex;align-items:center;justify-content:center}
.ev{padding-top:3px;font-size:21px;line-height:1.6}
.tm{font-weight:700;color:var(--ac-text);margin-right:10px;font-variant-numeric:tabular-nums}
.tx{color:#cbd5e1}
.tldr{display:flex;align-items:center;gap:12px;background:var(--ac-soft);border:1px solid var(--ac-soft);
border-radius:12px;padding:14px 18px;margin-top:20px}
.bulb{flex:none;width:34px;height:34px;border-radius:50%;background:var(--ac);color:#0b1220;
display:flex;align-items:center;justify-content:center;font-size:17px}
.tldr p{font-size:17px;line-height:1.6;color:#cbd5e1}
.tldr b{color:var(--ac-text)}`,
    ac,
  );
}
