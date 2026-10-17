/**
 * 泳道全景卡模板(M36 批②新增):流程/架构/原理类内容的「一张看懂」表达。
 * 视觉语法取自主流公众号流程图:大字报标题 + 泳道表头(角色/组件)+ 阶段
 * 横带(编号+名称+说明)+ 步骤节点(编号圆点,落在所属泳道列,编号递进
 * 表流转)+ 兜底摘要条。箭头连线简化为编号递进(数据结构化程度高、模板
 * 布局稳定);步骤序号 = 数组顺序,颜色 = 所属泳道。
 */
import { ACCENTS_LIGHT, escapeHtml, pickAccent, rich, wrapDocLight } from "./shell";

export type FlowData = {
  title: string;
  subtitle?: string;
  lanes: { name: string; emoji?: string }[];
  phases: { name: string; desc?: string }[];
  steps: { text: string; lane: number; phase: number }[];
  summary?: string;
};

/** 泳道色板(马卡龙系,浅底/深字/节点底三件套) */
const LANE_COLORS = [
  { head: "#fde3e3", text: "#c0392b", band: "#fef2f2", dot: "#e74c3c" },
  { head: "#dbeafe", text: "#1d4ed8", band: "#eff6ff", dot: "#3b82f6" },
  { head: "#d1fae5", text: "#047857", band: "#ecfdf5", dot: "#10b981" },
  { head: "#fef3c7", text: "#b45309", band: "#fffbeb", dot: "#f59e0b" },
] as const;

export function flowHtml(d: FlowData): string {
  const ac = pickAccent(ACCENTS_LIGHT, JSON.stringify(d));
  const gridCols = `110px repeat(${d.lanes.length},1fr)`;
  // 泳道色以内联注入(数量可变,CSS 类不可枚举)
  const laneHeads = d.lanes
    .map((l, i) => {
      const c = LANE_COLORS[i % LANE_COLORS.length];
      const emoji = l.emoji ? `${escapeHtml(l.emoji)} ` : "";
      return `<div class="lane" style="background:${c.head};color:${c.text}">${emoji}${rich(l.name)}</div>`;
    })
    .join("");
  // 步骤编号 = 全局数组序(同格多步骤也各持编号,按对象引用索引)
  const stepNum = new Map(d.steps.map((s, i) => [s, i + 1]));
  const bands = d.phases
    .map((ph, pi) => {
      const c = LANE_COLORS[pi % LANE_COLORS.length];
      const cells = d.lanes
        .map((_l, li) => {
          const laneDot = LANE_COLORS[li % LANE_COLORS.length].dot;
          const inCell = d.steps.filter((s) => s.phase === pi && s.lane === li);
          const chips = inCell
            .map((s) => {
              const n = stepNum.get(s);
              return `<div class="chip"><span class="n" style="background:${laneDot}">${n}</span><span>${rich(s.text)}</span></div>`;
            })
            .join("");
          return `<div class="cell">${chips}</div>`;
        })
        .join("");
      return `<div class="band" style="background:${c.band};grid-template-columns:${gridCols}">
<div class="phase"><div class="pnum" style="background:${c.dot}">${pi + 1}</div>
<div class="pname">${rich(ph.name)}</div>${ph.desc ? `<div class="pdesc">${rich(ph.desc)}</div>` : ""}</div>
<div class="cells" style="grid-template-columns:repeat(${d.lanes.length},1fr)">${cells}</div></div>`;
    })
    .join("");
  const summary = d.summary
    ? `<div class="tldr"><span class="bulb">💡</span><p><b>一眼看懂</b>&nbsp;|&nbsp;${rich(d.summary)}</p></div>`
    : "";
  return wrapDocLight(
    `<div class="title"><span class="hl" style="background:linear-gradient(transparent 55%,${ac.hl} 55%)">${rich(d.title)}</span></div>
${d.subtitle ? `<div class="subtitle">${rich(d.subtitle)}</div>` : ""}
<div class="lanes" style="grid-template-columns:${gridCols}"><div></div>${laneHeads}</div>
${bands}${summary}`,
    `.title{text-align:center;font-size:40px;font-weight:900}
.hl{padding:0 6px}
.subtitle{text-align:center;font-size:18px;color:#555;margin:10px 0 20px}
.lanes{display:grid;gap:8px;margin-bottom:8px}
.lane{border-radius:12px;padding:12px 4px;text-align:center;font-size:19px;font-weight:700}
.band{display:grid;gap:8px;border-radius:16px;padding:13px;margin-bottom:8px}
.phase{display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:0 4px}
.pnum{width:34px;height:34px;border-radius:50%;color:#fff;font-size:18px;font-weight:800;
display:flex;align-items:center;justify-content:center;margin-bottom:8px}
.pname{font-size:20px;font-weight:800}
.pdesc{font-size:12.5px;color:#888;margin-top:4px;line-height:1.4}
.cells{display:grid;gap:8px;grid-column:2/-1}
.cell{display:flex;flex-direction:column;gap:8px}
.chip{background:#fff;border-radius:10px;padding:10px 10px;font-size:14px;line-height:1.55;color:#333;
box-shadow:0 1px 4px rgba(0,0,0,.08);display:flex;gap:7px;align-items:flex-start;flex:1}
.chip .n{flex:none;width:20px;height:20px;border-radius:50%;color:#fff;font-size:12px;font-weight:700;
display:flex;align-items:center;justify-content:center;margin-top:2px}
.chip b{color:#111}
.tldr{display:flex;align-items:center;gap:12px;background:var(--ac-soft);border:1px solid var(--ac-hl);border-radius:12px;padding:13px 18px;margin-top:10px}
.bulb{flex:none;width:32px;height:32px;border-radius:50%;background:var(--ac);color:#fff;
display:flex;align-items:center;justify-content:center;font-size:16px}
.tldr p{font-size:16px;line-height:1.6}
.tldr b{color:var(--ac)}`,
    ac,
  );
}
