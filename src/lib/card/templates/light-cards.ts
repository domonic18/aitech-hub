/**
 * 浅色系卡模板(M36 批②):步骤/对比/时间线——流程与方法的表达。
 * 大字报标题(荧光笔高亮)+ 马卡龙色块编码语义;对比卡的两侧条目与
 * 结论条文字均可带 **加粗** 强调。
 */
import { rich, wrapDocLight } from "./shell";

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

/** 大字报标题行:荧光笔高亮底(高亮色随卡型传入,内联注入) */
function headline(title: string | undefined, hlColor: string): string {
  if (!title) return "";
  return `<div class="title"><span class="hl" style="background:linear-gradient(transparent 55%,${hlColor} 55%)">${rich(title)}</span></div>`;
}

export function stepsHtml(d: StepsData): string {
  const items = d.steps
    .map(
      (s, i) =>
        `<li><span class="no">${i + 1}</span><div class="li-body"><div class="st">${rich(s.title)}</div>${
          s.detail ? `<div class="sd">${rich(s.detail)}</div>` : ""
        }</div></li>`,
    )
    .join("");
  return wrapDocLight(
    `${headline(d.title, "#b7eb8f")}<ol class="sp">${items}</ol>`,
    `.title{text-align:center;font-size:42px;font-weight:900;margin-bottom:30px}
.hl{padding:0 6px}
.sp{list-style:none;position:relative}
.sp::before{content:"";position:absolute;left:23px;top:14px;bottom:14px;width:2px;background:#c7d2fe}
.sp li{position:relative;display:flex;gap:20px;padding:13px 0}
.no{flex:none;width:46px;height:46px;border-radius:50%;z-index:1;
background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-size:22px;font-weight:800;
display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(99,102,241,.35)}
.li-body{padding-top:4px}
.st{font-size:26px;font-weight:700}
.sd{font-size:19px;color:#6b7280;margin-top:4px}`,
  );
}

export function compareHtml(d: CompareData): string {
  const col = (side: CompareData["left"], cls: string) =>
    `<div class="cp-col ${cls}"><div class="cp-head">${rich(side.label)}</div><ul>${side.items
      .map((i) => `<li>${rich(i)}</li>`)
      .join("")}</ul></div>`;
  const verdict = d.verdict
    ? `<div class="verdict"><div class="ic">💡</div><p><b>结论</b>&nbsp;|&nbsp;${rich(d.verdict)}</p></div>`
    : "";
  return wrapDocLight(
    `${headline(d.title, "#c7d2fe")}<div class="cp">${col(d.left, "cp-l")}
<div class="vs"><div class="vsbadge">VS</div></div>
${col(d.right, "cp-r")}</div>${verdict}`,
    `.title{text-align:center;font-size:42px;font-weight:900;margin-bottom:28px}
.hl{padding:0 6px}
.cp{display:grid;grid-template-columns:1fr 64px 1fr;align-items:center}
.cp-col{border-radius:18px;padding:26px 28px}
.cp-l{background:#eff6ff;border:1.5px solid #bfdbfe}
.cp-r{background:#fffbeb;border:1.5px solid #fde68a}
.cp-head{font-size:26px;font-weight:800;text-align:center;margin-bottom:14px}
.cp-l .cp-head{color:#1d4ed8}.cp-r .cp-head{color:#b45309}
.cp-col ul{list-style:none}
.cp-col li{position:relative;padding:8px 0 8px 30px;font-size:20px;line-height:1.6}
.cp-col li::before{content:"·";position:absolute;left:8px;font-weight:800;font-size:28px;line-height:1}
.cp-l li::before{color:#3b82f6}.cp-r li::before{color:#f59e0b}
.vs{display:flex;align-items:center;justify-content:center}
.vsbadge{width:56px;height:56px;border-radius:50%;background:#111;color:#fff;font-size:21px;
font-weight:900;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.25)}
.verdict{display:flex;align-items:center;gap:12px;background:#f5f3ff;border:1px solid #ddd6fe;
border-radius:12px;padding:14px 18px;margin-top:22px}
.verdict .ic{flex:none;width:34px;height:34px;border-radius:50%;background:#7c3aed;color:#fff;
display:flex;align-items:center;justify-content:center;font-size:17px}
.verdict p{font-size:17px;line-height:1.6}
.verdict b{color:#5b21b6}`,
  );
}

export function timelineHtml(d: TimelineData): string {
  const items = d.events
    .map(
      (e, i) =>
        `<li><span class="dot">${i + 1}</span><div class="ev"><span class="tm">${rich(e.time)}</span><span class="tx">${rich(e.text)}</span></div></li>`,
    )
    .join("");
  const summary = d.summary
    ? `<div class="tldr"><span class="bulb">💡</span><p><b>一眼看懂</b>&nbsp;|&nbsp;${rich(d.summary)}</p></div>`
    : "";
  return wrapDocLight(
    `${headline(d.title, "#fde68a")}<ol class="tl">${items}</ol>${summary}`,
    `.title{text-align:center;font-size:42px;font-weight:900;margin-bottom:30px}
.hl{padding:0 6px}
.tl{list-style:none;position:relative}
.tl::before{content:"";position:absolute;left:20px;top:12px;bottom:12px;width:2px;background:#fcd34d}
.tl li{position:relative;display:flex;gap:18px;padding:11px 0;align-items:flex-start}
.dot{flex:none;width:40px;height:40px;border-radius:50%;z-index:1;color:#fff;font-size:18px;font-weight:800;
background:linear-gradient(135deg,#f59e0b,#f97316);display:flex;align-items:center;justify-content:center}
.ev{padding-top:3px;font-size:21px;line-height:1.6}
.tm{font-weight:800;color:#b45309;margin-right:10px}
.tx{color:#374151}
.tldr{display:flex;align-items:center;gap:12px;background:#fffbeb;border:1px solid #fde68a;
border-radius:12px;padding:14px 18px;margin-top:20px}
.bulb{flex:none;width:34px;height:34px;border-radius:50%;background:#f59e0b;color:#fff;
display:flex;align-items:center;justify-content:center;font-size:17px}
.tldr p{font-size:17px;line-height:1.6}
.tldr b{color:#92400e}`,
  );
}
