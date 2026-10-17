/**
 * 卡片 preset 注册表(M31 批B 建,M36 批② 扩容,M38 扩至 11 卡型并拆分):
 * 数据 JSON → 独立 HTML 文档(交 card-renderer 渲染)。
 * 定位=业务层排版语义:服务端只认 HTML→PNG,模板迭代改代码即生效,不动服务镜像。
 * 双模里的省钱模:agent 只产出数据(约 300-600 token/卡),排版由模板兜底;
 * 全部文本经转义,数据侧无注入面。画布 900px 固定宽(Noto CJK 由渲染容器提供)。
 *
 * schema 在 preset-schemas.ts,样张在 preset-samples.ts,本文件只管注册与分发。
 *
 * 主题(2026-10-18 用户裁定,M38 双主题/内容定系口径退役):全站 11 卡型统一
 * 深空主题——配图风格全篇统一属确定性机制,不依赖模型自觉;accent 三组按
 * **文章**(工具层传 thread_id 作 accentSeed)确定性取组,同篇恒同组、跨篇
 * 轮换破「每篇同款」。未传 seed 时退回按卡内容取组(admin 实验室预览用)。
 * 视觉模板在 src/lib/card/templates/(壳+各卡面);文本支持 **加粗** 强调
 * (templates/shell#rich,荧光笔底强调)。
 */
import { z } from "zod";

import { barsHtml, ledgerHtml } from "./templates/data-cards";
import { pointsHtml, quoteHtml, statsHtml } from "./templates/dark-cards";
import { flowHtml } from "./templates/swimlane-cards";
import { compareHtml, stepsHtml, timelineHtml } from "./templates/structure-cards";
import { matrixHtml, photoHtml } from "./templates/photo-cards";
import {
  barsSchema,
  compareSchema,
  flowSchema,
  ledgerSchema,
  matrixSchema,
  photoSchema,
  pointsSchema,
  quoteSchema,
  statsSchema,
  stepsSchema,
  timelineSchema,
} from "./preset-schemas";

export const CARD_PRESET_IDS = [
  "quote",
  "points",
  "stats",
  "bars",
  "ledger",
  "compare",
  "steps",
  "flow",
  "timeline",
  "matrix",
  "photo",
] as const;
export type CardPresetId = (typeof CARD_PRESET_IDS)[number];

/** preset 元信息(卡片模板库页展示用;全站统一深空主题,无 theme 字段) */
export const PRESET_META: Record<CardPresetId, { name: string; desc: string }> = {
  quote: { name: "金句卡", desc: "博主原话/锐评,观点放大器" },
  points: { name: "要点卡", desc: "方法要点/清单式干货,条目可带 emoji 图标" },
  stats: { name: "数据卡", desc: "关键数据,首条自动放大为主指标,可带涨跌标记" },
  bars: { name: "量级条形卡", desc: "多项相对量级对比(横条可视化)" },
  ledger: { name: "台账卡", desc: "规格参数/键值清单速览" },
  compare: { name: "对比卡", desc: "两方对垒/选型对比" },
  steps: { name: "步骤卡", desc: "操作步骤/落地路径" },
  flow: { name: "泳道全景卡", desc: "流程/架构一张看懂(泳道×阶段)" },
  timeline: { name: "时间线卡", desc: "演进历程/版本脉络" },
  matrix: { name: "矩阵卡", desc: "并列要素盘点(2~8 格自适应网格)" },
  photo: { name: "图片卡", desc: "大图+说明条(封面/截图/生成图)" },
};

type PresetDef = { schema: z.ZodType<unknown>; build: (data: unknown, seed: string) => string };

const PRESETS: Record<CardPresetId, PresetDef> = {
  quote: {
    schema: quoteSchema,
    build: (d, seed) => quoteHtml(d as z.infer<typeof quoteSchema>, seed),
  },
  points: {
    schema: pointsSchema,
    build: (d, seed) => pointsHtml(d as z.infer<typeof pointsSchema>, seed),
  },
  stats: {
    schema: statsSchema,
    build: (d, seed) => statsHtml(d as z.infer<typeof statsSchema>, seed),
  },
  bars: { schema: barsSchema, build: (d, seed) => barsHtml(d as z.infer<typeof barsSchema>, seed) },
  ledger: {
    schema: ledgerSchema,
    build: (d, seed) => ledgerHtml(d as z.infer<typeof ledgerSchema>, seed),
  },
  compare: {
    schema: compareSchema,
    build: (d, seed) => compareHtml(d as z.infer<typeof compareSchema>, seed),
  },
  steps: {
    schema: stepsSchema,
    build: (d, seed) => stepsHtml(d as z.infer<typeof stepsSchema>, seed),
  },
  flow: { schema: flowSchema, build: (d, seed) => flowHtml(d as z.infer<typeof flowSchema>, seed) },
  timeline: {
    schema: timelineSchema,
    build: (d, seed) => timelineHtml(d as z.infer<typeof timelineSchema>, seed),
  },
  matrix: {
    schema: matrixSchema,
    build: (d, seed) => matrixHtml(d as z.infer<typeof matrixSchema>, seed),
  },
  photo: {
    schema: photoSchema,
    build: (d, seed) => photoHtml(d as z.infer<typeof photoSchema>, seed),
  },
};

const CN_TYPE: Record<string, string> = {
  array: "数组",
  object: "对象",
  string: "字符串",
  number: "数字",
  boolean: "布尔",
  null: "null",
  undefined: "undefined",
};

/** zod issue → 中文短句(弱模型读不懂英文原话就不会自纠,见 ask_user 前科)。
 *  注:zod v4 的 invalid_type issue 只带 expected,received 仅在文案里,取不到。 */
function humanizeIssue(issue: z.core.$ZodIssue): string {
  const d = issue as unknown as {
    expected?: string;
    minimum?: number;
    maximum?: number;
    origin?: string;
  };
  if (issue.code === "invalid_type" && d.expected) {
    return `应为${CN_TYPE[d.expected] ?? d.expected},收到了其他类型`;
  }
  if (issue.code === "too_small" && typeof d.minimum === "number") {
    if (d.origin === "array") return `至少 ${d.minimum} 条`;
    if (d.origin === "string") return `至少 ${d.minimum} 字符`;
  }
  if (issue.code === "too_big" && typeof d.maximum === "number") {
    if (d.origin === "array") return `最多 ${d.maximum} 条`;
    if (d.origin === "string") return `最多 ${d.maximum} 字符`;
  }
  return issue.message;
}

/** 首个问题字段的人话报错;类型漂移(应为数组收到对象)附直接传数组的修正示例。 */
function formatPresetError(preset: CardPresetId, error: z.ZodError): string {
  const issue = error.issues[0];
  const where = issue.path.join(".");
  const d = issue as unknown as { expected?: string };
  const arrDrift = issue.code === "invalid_type" && d.expected === "array";
  const hint = arrDrift
    ? ';数组字段直接传 JSON 数组(如 "rows":[{"k":"键","v":"值"}]),' +
      "不要包进对象,也不要拆成对象逐条传"
    : "";
  return `${preset} 模板数据不合法:${where || "(根)"} ${humanizeIssue(issue)}${hint}`;
}

/**
 * 数据卡渲染入口:zod 校验失败给人话报错(首个问题字段),agent 可自纠重试。
 * accentSeed = 文章锚(工具层传 thread_id):同篇恒同 accent 组;缺省退回按
 * 卡内容取组(admin 实验室预览,重渲染同数据恒同色)。
 */
export function renderPreset(
  preset: CardPresetId,
  data: unknown,
  accentSeed?: string,
): { ok: true; html: string } | { ok: false; error: string } {
  const p = PRESETS[preset];
  const parsed = p.schema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: formatPresetError(preset, parsed.error) };
  }
  return { ok: true, html: p.build(parsed.data, accentSeed ?? JSON.stringify(parsed.data)) };
}
