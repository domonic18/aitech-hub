/**
 * 卡片 preset 模板(M31 批B 建,M36 批② 扩容为双主题 7 卡型):
 * 数据 JSON → 独立 HTML 文档(交 card-renderer 渲染)。
 * 定位=业务层排版语义:服务端只认 HTML→PNG,模板迭代改代码即生效,不动服务镜像。
 * 双模里的省钱模:agent 只产出数据(约 300-600 token/卡),排版由模板兜底;
 * 全部文本经转义,数据侧无注入面。画布 900px 固定宽(Noto CJK 由渲染容器提供)。
 *
 * 双主题(M36 调研口径:全文同色系不混彩):
 * - dark 深空蓝紫系 = 观点/数据(quote/points/stats);
 * - light 马卡龙浅色系 = 流程/方法(steps/compare/timeline/flow)。
 * 视觉模板构建器在 src/lib/card/templates/(壳+各系卡面),本文件只管
 * schema 校验与分发;文本支持 **加粗** 强调(templates/shell#rich)。
 */
import { z } from "zod";

import { pointsHtml, quoteHtml, statsHtml } from "./templates/dark-cards";
import { flowHtml } from "./templates/light-flow";
import { compareHtml, stepsHtml, timelineHtml } from "./templates/light-cards";

export const CARD_PRESET_IDS = [
  "quote",
  "points",
  "stats",
  "compare",
  "steps",
  "flow",
  "timeline",
] as const;
export type CardPresetId = (typeof CARD_PRESET_IDS)[number];

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
  verdict: z.string().max(300).optional().describe("底部结论条(你的判断),可省略"),
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

const flowSchema = z
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

const timelineSchema = z.object({
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

/**
 * preset 元信息(卡片模板库页展示用;theme 对应视觉主题系,M36 双主题:
 * dark=观点/数据系,light=流程/方法系)。
 */
export const PRESET_META: Record<
  CardPresetId,
  { name: string; desc: string; theme: "dark" | "light" }
> = {
  quote: { name: "金句卡", desc: "博主原话/锐评,观点放大器", theme: "dark" },
  points: { name: "要点卡", desc: "方法要点/清单式干货", theme: "dark" },
  stats: { name: "数据卡", desc: "关键数据/结论数字突出", theme: "dark" },
  compare: { name: "对比卡", desc: "两方对垒/选型对比", theme: "light" },
  steps: { name: "步骤卡", desc: "操作步骤/落地路径", theme: "light" },
  flow: { name: "泳道全景卡", desc: "流程/架构一张看懂(泳道×阶段)", theme: "light" },
  timeline: { name: "时间线卡", desc: "演进历程/版本脉络", theme: "light" },
};

/** preset 示例数据(模板库页预填;亦是各卡型的字段口径示范) */
export const PRESET_SAMPLE_DATA: Record<CardPresetId, unknown> = {
  quote: {
    quote: "模型的能力上限决定产品的上限,交互的体验下限决定用户的去留",
    author: "某科技博主 · B站《AI 产品方法论》",
  },
  points: {
    title: "三步搭建本地知识库",
    points: [
      "选型:本地部署优先 Ollama,显存 8G 起步",
      "灌库:文档切块 512 token 重叠 64,召回率提升 23%",
      "问答:先检索后生成,引用原文出处",
    ],
  },
  stats: {
    title: "2026 AI 工作流调研",
    items: [
      { value: "92%", label: "受访者认为 AI 已实质改变工作流" },
      { value: "3.2×", label: "效率提升中位数" },
      { value: "18 分钟", label: "平均日节省" },
    ],
  },
  compare: {
    title: "本地部署 vs 云端 API",
    left: {
      label: "🖥️ 本地部署",
      items: ["数据不出机器,隐私零顾虑", "高频调用成本随用量摊薄", "离线环境完全可用"],
    },
    right: {
      label: "☁️ 云端 API",
      items: ["上手即用,无需运维 GPU", "旗舰模型效果天花板", "弹性扩缩按需付费"],
    },
    verdict: "个人学习与隐私敏感场景选本地,生产业务与追新模型选云端 API",
  },
  steps: {
    title: "RAG 知识库落地四步",
    steps: [
      { title: "语料清洗", detail: "去重、去噪、按语义切块" },
      { title: "向量化入库", detail: "bge-m3 嵌入,建向量索引" },
      { title: "检索调优", detail: "TopK 召回 + 重排过滤" },
      { title: "引用生成", detail: "答案强制标注原文出处" },
    ],
  },
  flow: {
    title: "AI Agent 运行全流程",
    subtitle: "一次任务从提出到交付的完整链路",
    lanes: [
      { name: "用户", emoji: "🧑" },
      { name: "Agent 大脑", emoji: "🧠" },
      { name: "工具集", emoji: "🛠️" },
    ],
    phases: [
      { name: "接收任务", desc: "明确目标与约束" },
      { name: "思考规划", desc: "拆解步骤选工具" },
      { name: "执行反馈", desc: "调用工具迭代修正" },
      { name: "交付结果", desc: "汇总产出" },
    ],
    steps: [
      { text: "提出任务", lane: 0, phase: 0 },
      { text: "理解意图", lane: 1, phase: 0 },
      { text: "拆解子任务", lane: 1, phase: 1 },
      { text: "选择工具", lane: 1, phase: 1 },
      { text: "执行调用", lane: 2, phase: 2 },
      { text: "返回结果", lane: 2, phase: 2 },
      { text: "检查与重试", lane: 1, phase: 2 },
      { text: "输出答案", lane: 1, phase: 3 },
      { text: "确认收货", lane: 0, phase: 3 },
    ],
    summary: "Agent = 大脑(规划)+ 工具(执行)+ 反馈循环(修正),循环到任务完成",
  },
  timeline: {
    title: "大模型上下文窗口进化史",
    events: [
      { time: "2020.05", text: "GPT-3 发布,4K 上下文成为起点" },
      { time: "2023.03", text: "GPT-4带来 32K,长文档处理成为可能" },
      { time: "2023.11", text: "各家卷向 128K,整本书一次读完" },
      { time: "2024", text: "Gemini 1.5 破到 1M,视频级输入" },
      { time: "2026", text: "百万级成主流,记忆管理转向分层架构" },
    ],
    summary: "窗口每扩大一个量级,应用形态就换一代:问答 → 文档 → 全库",
  },
};

type PresetDef = { schema: z.ZodType<unknown>; build: (data: unknown) => string };

const PRESETS: Record<CardPresetId, PresetDef> = {
  quote: { schema: quoteSchema, build: (d) => quoteHtml(d as z.infer<typeof quoteSchema>) },
  points: { schema: pointsSchema, build: (d) => pointsHtml(d as z.infer<typeof pointsSchema>) },
  stats: { schema: statsSchema, build: (d) => statsHtml(d as z.infer<typeof statsSchema>) },
  compare: { schema: compareSchema, build: (d) => compareHtml(d as z.infer<typeof compareSchema>) },
  steps: { schema: stepsSchema, build: (d) => stepsHtml(d as z.infer<typeof stepsSchema>) },
  flow: { schema: flowSchema, build: (d) => flowHtml(d as z.infer<typeof flowSchema>) },
  timeline: {
    schema: timelineSchema,
    build: (d) => timelineHtml(d as z.infer<typeof timelineSchema>),
  },
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
