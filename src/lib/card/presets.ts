/**
 * 卡片 preset 模板(M31 批B):数据 JSON → 独立 HTML 文档(交 card-renderer 渲染)。
 * 定位=业务层排版语义:服务端只认 HTML→PNG,模板迭代改本文件即生效,不动服务镜像。
 * 双模里的省钱模:agent 只产出数据(约 300-600 token/卡),排版由模板兜底;
 * 全部文本经 escapeHtml,数据侧无注入面。视觉基调=站内白底+蓝紫渐变点缀,
 * 画布 900px 固定宽(Noto CJK 由渲染容器提供)。
 */
import { z } from "zod";

export const CARD_PRESET_IDS = ["quote", "points", "stats", "compare", "steps"] as const;
export type CardPresetId = (typeof CARD_PRESET_IDS)[number];

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** 模板公共壳:独立文档 + 基础排版变量(padding 内即卡面,截图为整页) */
function wrapDoc(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
:root{--ink:#1f2937;--sub:#6b7280;--accent:#4f46e5;--line:#e5e7eb;--bg:#ffffff}
*{box-sizing:border-box;margin:0;padding:0}
body{width:900px;background:var(--bg);font-family:"Noto Sans CJK SC","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;color:var(--ink);line-height:1.6}
.card{padding:56px 64px}
.badge{display:inline-block;font-size:20px;font-weight:600;color:var(--accent);letter-spacing:2px;margin-bottom:20px}
.title{font-size:40px;font-weight:700;line-height:1.35;margin-bottom:8px}
</style></head><body><div class="card">${body}</div></body></html>`;
}

const quoteSchema = z.object({
  quote: z.string().min(1).max(500).describe("金句正文"),
  author: z.string().max(100).optional().describe("出处/作者,可省略"),
});

const pointsSchema = z.object({
  title: z.string().max(100).optional().describe("卡片标题,可省略"),
  points: z.array(z.string().min(1).max(300)).min(2).max(8).describe("要点列表,2~8 条"),
});

const statsSchema = z.object({
  title: z.string().max(100).optional().describe("卡片标题,可省略"),
  items: z
    .array(
      z.object({
        value: z.string().min(1).max(30).describe("数值(如 78%/3.5x/Top1)"),
        label: z.string().min(1).max(60).describe("数值说明"),
      }),
    )
    .min(2)
    .max(6)
    .describe("数据对,2~6 组"),
});

const sideSchema = z.object({
  label: z.string().min(1).max(40).describe("栏目标题"),
  items: z.array(z.string().min(1).max(200)).min(1).max(6).describe("该栏条目,1~6 条"),
});

const compareSchema = z.object({
  title: z.string().max(100).optional().describe("卡片标题,可省略"),
  left: sideSchema,
  right: sideSchema,
});

const stepsSchema = z.object({
  title: z.string().max(100).optional().describe("卡片标题,可省略"),
  steps: z
    .array(
      z.object({
        title: z.string().min(1).max(60).describe("步骤名"),
        detail: z.string().max(200).optional().describe("步骤说明,可省略"),
      }),
    )
    .min(2)
    .max(8)
    .describe("步骤序列,2~8 步"),
});

function quoteHtml(d: z.infer<typeof quoteSchema>): string {
  const author = d.author ? `<div class="q-author">—— ${escapeHtml(d.author)}</div>` : "";
  return wrapDoc(`<div class="q-mark">“</div><div class="q-text">${escapeHtml(d.quote)}</div>${author}
<style>.q-mark{font-size:120px;line-height:1;color:var(--accent);opacity:.25;font-family:Georgia,serif}
.q-text{font-size:44px;font-weight:600;line-height:1.6;margin:-30px 0 28px}
.q-author{font-size:24px;color:var(--sub)}</style>`);
}

function pointsHtml(d: z.infer<typeof pointsSchema>): string {
  const title = d.title ? `<div class="title">${escapeHtml(d.title)}</div>` : "";
  const items = d.points.map((p) => `<li>${escapeHtml(p)}</li>`).join("");
  return wrapDoc(`${title}<ul class="pts">${items}</ul>
<style>${title ? ".pts{margin-top:28px}" : ".pts{margin-top:8px}"}
.pts{list-style:none}
.pts li{position:relative;padding:14px 0 14px 52px;font-size:28px;border-bottom:1px solid var(--line)}
.pts li:last-child{border-bottom:none}
.pts li::before{content:"";position:absolute;left:6px;top:26px;width:14px;height:14px;border-radius:4px;background:var(--accent);opacity:.85}</style>`);
}

function statsHtml(d: z.infer<typeof statsSchema>): string {
  const title = d.title ? `<div class="title">${escapeHtml(d.title)}</div>` : "";
  const cells = d.items
    .map(
      (it) =>
        `<div class="st"><div class="st-v">${escapeHtml(it.value)}</div><div class="st-l">${escapeHtml(it.label)}</div></div>`,
    )
    .join("");
  return wrapDoc(`${title}<div class="st-grid">${cells}</div>
<style>${title ? ".st-grid{margin-top:32px}" : ".st-grid{margin-top:12px}"}
.st-grid{display:flex;flex-wrap:wrap;gap:20px}
.st{flex:1 1 30%;min-width:220px;padding:30px 26px;border:1px solid var(--line);border-radius:16px;background:linear-gradient(180deg,#f8faff 0%,#ffffff 100%)}
.st-v{font-size:52px;font-weight:700;color:var(--accent);line-height:1.2}
.st-l{font-size:22px;color:var(--sub);margin-top:8px}</style>`);
}

function compareHtml(d: z.infer<typeof compareSchema>): string {
  const title = d.title ? `<div class="title">${escapeHtml(d.title)}</div>` : "";
  const col = (side: z.infer<typeof sideSchema>, cls: string) =>
    `<div class="cp-col ${cls}"><div class="cp-head">${escapeHtml(side.label)}</div><ul>${side.items
      .map((i) => `<li>${escapeHtml(i)}</li>`)
      .join("")}</ul></div>`;
  return wrapDoc(`${title}<div class="cp">${col(d.left, "cp-l")}${col(d.right, "cp-r")}</div>
<style>${title ? ".cp{margin-top:32px}" : ".cp{margin-top:12px}"}
.cp{display:flex;gap:24px}
.cp-col{flex:1;border-radius:16px;padding:30px 32px;border:1px solid var(--line)}
.cp-l{background:#f0f6ff;border-color:#cfe0f5}
.cp-r{background:#f5f0ff;border-color:#ddd0f5}
.cp-head{font-size:30px;font-weight:700;margin-bottom:16px}
.cp-l .cp-head{color:#1d4ed8}.cp-r .cp-head{color:#6d28d9}
.cp-col ul{list-style:none}
.cp-col li{position:relative;padding:10px 0 10px 34px;font-size:24px}
.cp-col li::before{content:"·";position:absolute;left:8px;font-weight:800;font-size:30px;line-height:1;color:var(--sub)}</style>`);
}

function stepsHtml(d: z.infer<typeof stepsSchema>): string {
  const title = d.title ? `<div class="title">${escapeHtml(d.title)}</div>` : "";
  const items = d.steps
    .map(
      (s, i) =>
        `<li><span class="sp-no">${i + 1}</span><div><div class="sp-t">${escapeHtml(s.title)}</div>${
          s.detail ? `<div class="sp-d">${escapeHtml(s.detail)}</div>` : ""
        }</div></li>`,
    )
    .join("");
  return wrapDoc(`${title}<ol class="sp">${items}</ol>
<style>${title ? ".sp{margin-top:28px}" : ".sp{margin-top:8px}"}
.sp{list-style:none}
.sp li{display:flex;gap:22px;align-items:flex-start;padding:16px 0;border-bottom:1px solid var(--line)}
.sp li:last-child{border-bottom:none}
.sp-no{flex:none;width:46px;height:46px;border-radius:50%;background:var(--accent);color:#fff;font-size:24px;font-weight:700;display:flex;align-items:center;justify-content:center}
.sp-t{font-size:28px;font-weight:600;padding-top:6px}
.sp-d{font-size:22px;color:var(--sub);margin-top:4px}</style>`);
}

type PresetDef = { schema: z.ZodType<unknown>; build: (data: unknown) => string };

const PRESETS: Record<CardPresetId, PresetDef> = {
  quote: { schema: quoteSchema, build: (d) => quoteHtml(d as z.infer<typeof quoteSchema>) },
  points: { schema: pointsSchema, build: (d) => pointsHtml(d as z.infer<typeof pointsSchema>) },
  stats: { schema: statsSchema, build: (d) => statsHtml(d as z.infer<typeof statsSchema>) },
  compare: { schema: compareSchema, build: (d) => compareHtml(d as z.infer<typeof compareSchema>) },
  steps: { schema: stepsSchema, build: (d) => stepsHtml(d as z.infer<typeof stepsSchema>) },
};

/**
 * 数据卡渲染入口:zod 校验失败给人话报错(首个问题字段),agent 可自纠重试。
 */
export function renderPreset(
  preset: CardPresetId,
  data: unknown,
): { ok: true; html: string } | { ok: false; error: string } {
  const p = PRESETS[preset];
  const parsed = p.schema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.join(".");
    return { ok: false, error: `${preset} 模板数据不合法:${where || "(根)"} ${issue.message}` };
  }
  return { ok: true, html: p.build(parsed.data) };
}
