/**
 * 泳道全景卡模板(M36 批②新增,原名 light-flow.ts;2026-10-18 统一深空重皮并更名):
 * 流程/架构/原理类内容的「一张看懂」表达。
 * 视觉语法取自主流公众号流程图:大字报标题 + 泳道表头(角色/组件)+ 阶段
 * 横带(编号+名称+说明)+ 步骤节点(编号圆点,落在所属泳道列,编号递进
 * 表流转)+ 兜底摘要条。箭头连线简化为编号递进(数据结构化程度高、模板
 * 布局稳定);步骤序号 = 数组顺序,颜色 = 所属泳道。
 * 深空重皮口径:泳道四色改深底透明三件套(表头深 tint/亮字,横带更深 tint,
 * 节点圆点=饱和亮色);chip 为灰蓝半透明卡。
 */
import { ACCENTS, escapeHtml, pickAccent, rich, wrapDocDark, headline } from "./shell";

export type FlowData = {
  title: string;
  subtitle?: string;
  lanes: { name: string; emoji?: string }[];
  phases: { name: string; desc?: string }[];
  steps: { text: string; lane: number; phase: number }[];
  summary?: string;
};

/** 泳道色板(深空口径,表头底/表头字/横带底/节点圆点四件套) */
const LANE_COLORS = [
  { head: "rgba(248,113,113,.16)", text: "#fca5a5", band: "rgba(248,113,113,.07)", dot: "#ef4444" },
  { head: "rgba(96,165,250,.16)", text: "#93c5fd", band: "rgba(96,165,250,.07)", dot: "#3b82f6" },
  { head: "rgba(52,211,153,.14)", text: "#6ee7b7", band: "rgba(52,211,153,.06)", dot: "#10b981" },
  { head: "rgba(251,191,36,.14)", text: "#fcd34d", band: "rgba(251,191,36,.06)", dot: "#f59e0b" },
] as const;

export function flowHtml(d: FlowData, seed?: string): string {
  const ac = pickAccent(ACCENTS, seed ?? JSON.stringify(d));
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
  return wrapDocDark(
    `${headline(d.title, ac)}
${d.subtitle ? `<div class="subtitle">${rich(d.subtitle)}</div>` : ""}
<div class="lanes" style="grid-template-columns:${gridCols}"><div></div>${laneHeads}</div>
${bands}${summary}`,
    `.title{text-align:center;font-size:38px;font-weight:700}
.title .hl{padding:2px 12px;border-radius:8px}
.subtitle{text-align:center;font-size:18px;color:#94a3b8;margin:10px 0 20px}
.lanes{display:grid;gap:8px;margin-bottom:8px}
.lane{border-radius:12px;padding:12px 4px;text-align:center;font-size:19px;font-weight:700}
.band{display:grid;gap:8px;border-radius:16px;padding:13px;margin-bottom:8px}
.phase{display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:0 4px}
.pnum{width:34px;height:34px;border-radius:50%;color:#0b1220;font-size:18px;font-weight:800;
display:flex;align-items:center;justify-content:center;margin-bottom:8px}
.pname{font-size:20px;font-weight:800}
.pdesc{font-size:12.5px;color:#94a3b8;margin-top:4px;line-height:1.4}
.cells{display:grid;gap:8px;grid-column:2/-1}
.cell{display:flex;flex-direction:column;gap:8px}
.chip{background:rgba(148,163,184,.08);border:1px solid rgba(148,163,184,.14);border-radius:10px;
padding:10px 10px;font-size:14px;line-height:1.55;color:#e2e8f0;display:flex;gap:7px;align-items:flex-start;flex:1}
.chip .n{flex:none;width:20px;height:20px;border-radius:50%;color:#0b1220;font-size:12px;font-weight:700;
display:flex;align-items:center;justify-content:center;margin-top:2px}
.chip b{color:#f1f5f9}
.tldr{display:flex;align-items:center;gap:12px;background:var(--ac-soft);border:1px solid var(--ac-soft);border-radius:12px;padding:13px 18px;margin-top:10px}
.bulb{flex:none;width:32px;height:32px;border-radius:50%;background:var(--ac);color:#0b1220;
display:flex;align-items:center;justify-content:center;font-size:16px}
.tldr p{font-size:16px;line-height:1.6;color:#cbd5e1}
.tldr b{color:var(--ac-text)}`,
    ac,
  );
}
