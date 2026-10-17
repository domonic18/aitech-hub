/**
 * 卡片 preset 注册表(M31 批B 建,M36 批② 扩容,M38 扩至 11 卡型并拆分):
 * 数据 JSON → 独立 HTML 文档(交 card-renderer 渲染)。
 * 定位=业务层排版语义:服务端只认 HTML→PNG,模板迭代改代码即生效,不动服务镜像。
 * 双模里的省钱模:agent 只产出数据(约 300-600 token/卡),排版由模板兜底;
 * 全部文本经转义,数据侧无注入面。画布 900px 固定宽(Noto CJK 由渲染容器提供)。
 *
 * schema 在 preset-schemas.ts,样张在 preset-samples.ts,本文件只管注册与分发。
 *
 * 双主题(M38 口径,全文同色系不混彩):
 * - dark 深空系 = 观点/数据(quote/points/stats/bars/ledger);
 * - light 浅色系 = 流程/方法(compare/steps/flow/timeline/matrix/photo)。
 * 视觉模板在 src/lib/card/templates/(壳+各系卡面);文本支持 **加粗** 强调
 * (templates/shell#rich,荧光笔底强调)。
 */
import { z } from "zod";

import { barsHtml, ledgerHtml } from "./templates/data-cards";
import { pointsHtml, quoteHtml, statsHtml } from "./templates/dark-cards";
import { flowHtml } from "./templates/light-flow";
import { compareHtml, stepsHtml, timelineHtml } from "./templates/light-cards";
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

/**
 * preset 元信息(卡片模板库页展示用;theme 对应视觉主题系:
 * dark=观点/数据系,light=流程/方法系)。
 */
export const PRESET_META: Record<
  CardPresetId,
  { name: string; desc: string; theme: "dark" | "light" }
> = {
  quote: { name: "金句卡", desc: "博主原话/锐评,观点放大器", theme: "dark" },
  points: { name: "要点卡", desc: "方法要点/清单式干货,条目可带 emoji 图标", theme: "dark" },
  stats: { name: "数据卡", desc: "关键数据,首条自动放大为主指标,可带涨跌标记", theme: "dark" },
  bars: { name: "量级条形卡", desc: "多项相对量级对比(横条可视化)", theme: "dark" },
  ledger: { name: "台账卡", desc: "规格参数/键值清单速览", theme: "dark" },
  compare: { name: "对比卡", desc: "两方对垒/选型对比", theme: "light" },
  steps: { name: "步骤卡", desc: "操作步骤/落地路径", theme: "light" },
  flow: { name: "泳道全景卡", desc: "流程/架构一张看懂(泳道×阶段)", theme: "light" },
  timeline: { name: "时间线卡", desc: "演进历程/版本脉络", theme: "light" },
  matrix: { name: "矩阵卡", desc: "并列要素盘点(2~8 格自适应网格)", theme: "light" },
  photo: { name: "图片卡", desc: "大图+说明条(封面/截图/生成图)", theme: "light" },
};

type PresetDef = { schema: z.ZodType<unknown>; build: (data: unknown) => string };

const PRESETS: Record<CardPresetId, PresetDef> = {
  quote: { schema: quoteSchema, build: (d) => quoteHtml(d as z.infer<typeof quoteSchema>) },
  points: { schema: pointsSchema, build: (d) => pointsHtml(d as z.infer<typeof pointsSchema>) },
  stats: { schema: statsSchema, build: (d) => statsHtml(d as z.infer<typeof statsSchema>) },
  bars: { schema: barsSchema, build: (d) => barsHtml(d as z.infer<typeof barsSchema>) },
  ledger: { schema: ledgerSchema, build: (d) => ledgerHtml(d as z.infer<typeof ledgerSchema>) },
  compare: { schema: compareSchema, build: (d) => compareHtml(d as z.infer<typeof compareSchema>) },
  steps: { schema: stepsSchema, build: (d) => stepsHtml(d as z.infer<typeof stepsSchema>) },
  flow: { schema: flowSchema, build: (d) => flowHtml(d as z.infer<typeof flowSchema>) },
  timeline: {
    schema: timelineSchema,
    build: (d) => timelineHtml(d as z.infer<typeof timelineSchema>),
  },
  matrix: { schema: matrixSchema, build: (d) => matrixHtml(d as z.infer<typeof matrixSchema>) },
  photo: { schema: photoSchema, build: (d) => photoHtml(d as z.infer<typeof photoSchema>) },
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
