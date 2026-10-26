/**
 * 卡片 preset 数据 schema(M31 批B 建,M38 扩至 11 卡型并拆出本文件):
 * zod 校验即 agent 的数据契约,describe 即字段口径(模型按它填数)。
 * 从 presets.ts 拆出:presets.ts 只留注册表与分发,本文件只留 schema。
 * 文本字段一律 min/max 限长(卡面版式稳定);photo.src 白名单站内路径。
 */
import { z } from "zod";

import { SITE_UPLOADS_PREFIX } from "../media/refs";

export const quoteSchema = z.object({
  quote: z.string().min(1).max(500).describe("金句正文"),
  author: z.string().max(100).optional().describe("出处/作者,可省略"),
});

export const pointsSchema = z.object({
  title: z.string().max(100).optional().describe("卡片标题,可省略"),
  points: z
    .array(
      z.object({
        text: z.string().min(1).max(300).describe("要点正文,支持 **加粗** 强调"),
        icon: z.string().max(8).optional().describe("条目 emoji 图标,可省略"),
      }),
    )
    .min(2)
    .max(8)
    .describe("要点列表,2~8 条"),
});

export const statsSchema = z.object({
  title: z.string().max(100).optional().describe("卡片标题,可省略"),
  items: z
    .array(
      z.object({
        value: z.string().min(1).max(30).describe("数值(如 78%/3.5x/Top1)"),
        label: z.string().min(1).max(60).describe("数值说明"),
        delta: z
          .string()
          .max(20)
          .optional()
          .describe("涨跌标记(如 +23%/-12%),可省略;▲绿▼红自动着色"),
      }),
    )
    .min(2)
    .max(6)
    .describe("数据对,2~6 组;首条自动放大为主指标"),
});

export const barsSchema = z.object({
  title: z.string().max(100).optional().describe("卡片标题,可省略"),
  unit: z.string().max(20).optional().describe("量纲说明(如 %、万 token/s),可省略"),
  items: z
    .array(
      z.object({
        label: z.string().min(1).max(40).describe("条目名(如 模型A/方案B)"),
        pct: z.number().int().min(1).max(100).describe("条长相对刻度 1~100(最大者取 100)"),
        value: z.string().min(1).max(20).describe("显示值(精确数字写这里)"),
      }),
    )
    .min(2)
    .max(6)
    .describe("量级条目,2~6 条,按 pct 降序填"),
});

export const ledgerSchema = z.object({
  title: z.string().max(100).optional().describe("卡片标题,可省略"),
  rows: z
    .array(
      z.object({
        k: z.string().min(1).max(40).describe("条目名(参数/配置项)"),
        v: z.string().min(1).max(60).describe("值"),
      }),
    )
    .min(3)
    .max(12)
    .describe("键值行,3~12 行"),
});

const sideSchema = z.object({
  label: z.string().min(1).max(40).describe("栏目标题"),
  items: z.array(z.string().min(1).max(200)).min(1).max(6).describe("该栏条目,1~6 条"),
});

export const compareSchema = z.object({
  title: z.string().max(100).optional().describe("卡片标题,可省略"),
  left: sideSchema,
  right: sideSchema,
  verdict: z.string().max(300).optional().describe("底部结论条(你的判断),可省略"),
});

export const stepsSchema = z.object({
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

export const flowSchema = z
  .object({
    title: z.string().min(1).max(60).describe("全景图大标题"),
    subtitle: z.string().max(120).optional().describe("副标题,可省略"),
    lanes: z
      .array(
        z.object({
          name: z.string().min(1).max(20).describe("泳道名(角色/组件)"),
          emoji: z.string().max(8).optional().describe("泳道 emoji,可省略"),
        }),
      )
      .min(2)
      .max(4)
      .describe("泳道(横向分栏)2~4 条"),
    phases: z
      .array(
        z.object({
          name: z.string().min(1).max(20).describe("阶段名"),
          desc: z.string().max(60).optional().describe("阶段说明,可省略"),
        }),
      )
      .min(2)
      .max(5)
      .describe("阶段横带 2~5 段"),
    steps: z
      .array(
        z.object({
          text: z.string().min(1).max(120).describe("步骤文本"),
          lane: z.number().int().min(0).describe("所属泳道序号(从 0 起,lanes 下标)"),
          phase: z.number().int().min(0).describe("所属阶段序号(从 0 起,phases 下标)"),
        }),
      )
      .min(3)
      .max(16)
      .describe("步骤节点 3~16 个;数组顺序即全局流转顺序(卡片按此编号)"),
    summary: z.string().max(200).optional().describe("底部「一眼看懂」摘要条,可省略"),
  })
  .superRefine((d, ctx) => {
    d.steps.forEach((s, i) => {
      if (s.lane >= d.lanes.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", i, "lane"],
          message: `泳道序号 ${s.lane} 超出范围(共 ${d.lanes.length} 条,从 0 起)`,
        });
      }
      if (s.phase >= d.phases.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", i, "phase"],
          message: `阶段序号 ${s.phase} 超出范围(共 ${d.phases.length} 段,从 0 起)`,
        });
      }
    });
  });

export const timelineSchema = z.object({
  title: z.string().max(100).optional().describe("卡片标题,可省略"),
  events: z
    .array(
      z.object({
        time: z.string().min(1).max(20).describe("时间/节点标记(如 2022.11/-v1/V3.5)"),
        text: z.string().min(1).max(200).describe("该节点发生的事"),
      }),
    )
    .min(2)
    .max(8)
    .describe("时间线节点,2~8 个(按时间序)"),
  summary: z.string().max(300).optional().describe("底部「一眼看懂」摘要条,可省略"),
});

export const matrixSchema = z.object({
  title: z.string().max(100).optional().describe("卡片标题,可省略"),
  cells: z
    .array(
      z.object({
        name: z.string().min(1).max(30).describe("要素名"),
        desc: z.string().max(80).optional().describe("一句话说明,可省略"),
        icon: z.string().max(8).optional().describe("要素 emoji 图标,可省略"),
      }),
    )
    .min(2)
    .max(8)
    .describe("并列要素格,2~8 格(列数自动适配)"),
});

export const photoSchema = z.object({
  src: z
    .string()
    .startsWith(SITE_UPLOADS_PREFIX)
    .describe("图片站内路径(/wp-content/uploads/…,来自媒体库/封面转存/生成图)"),
  title: z.string().max(60).optional().describe("图上大字报标题,可省略"),
  caption: z.string().max(200).optional().describe("底部说明条,可省略"),
});
