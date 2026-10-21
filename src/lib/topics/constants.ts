/**
 * 专题内容管线常量(M26,方案锚 docs/plan/topic-pipeline-plan.md):
 * 状态机/素材类型一处收敛;合法值应用层 Zod 管控(arch/03 枚举演进条款)。
 */

export const TOPIC_STATUS = ["collecting", "drafted", "published"] as const;
export type TopicStatus = (typeof TOPIC_STATUS)[number];

/** 状态展示名(2026-10-20 详情页重构:去「合成」术语,讲用户语言——
 * DB 枚举值不变,仅展示层文案;列表分段签/详情步进条/徽标同源) */
export const TOPIC_STATUS_LABEL: Record<TopicStatus, string> = {
  collecting: "收集素材中",
  drafted: "初稿已生成",
  published: "已发布",
};

/** 列表分段白名单(全部 + 三态;?status= 解析用) */
export const TOPIC_LIST_SEGMENTS = ["all", ...TOPIC_STATUS] as const;

/** 人工可驱动的状态迁移(§10-7:collecting→drafted 仅由合成驱动,治理台不出该钮;
 * published↔drafted/collecting 为人工回退,collecting→published 为人工关联文章
 * 发布旁路)。UI 钮组与 API 文档口径同源。 */
export const MANUAL_STATUS_TARGETS: Record<TopicStatus, readonly TopicStatus[]> = {
  collecting: ["published"],
  drafted: ["collecting", "published"],
  published: ["drafted"],
};

export const TOPIC_ITEM_TYPE = ["telegram", "post"] as const;
export type TopicItemType = (typeof TOPIC_ITEM_TYPE)[number];

/**
 * 新建专题定位预填(M27 批①合成重构,1276 验收反馈「不要每次现填」):
 * 缺省角度=博主×视频推荐体;固定结构模板在 compose.ts 代码内,此处只做
 * 用户可改的补充指令底稿(清空也合法——合成不依赖它)。
 * 2026-10-18 体裁治理:本文案即「视频安利」目的的定位模板(TOPIC_PURPOSES)。
 */
export const DEFAULT_TOPIC_POSITIONING =
  "围绕「这个博主值得关注意在什么、这支视频讲透了什么」来选材:" +
  "优先带出视频里最反差或最具体的事实、数据与结论;口吻口语化,像懂行朋友安利,不写新闻通稿腔。";

/** 「视频安利+文字版教程」目的的定位模板(教程类视频:核心内容笔记=可跟做的
 * 分步教程,不做第三人称转述;写法规范住 blogger-video 指南「教程类视频」分支) */
export const TUTORIAL_TOPIC_POSITIONING =
  "本篇素材为教程类视频:核心内容笔记按「文字版教程」交付——把操作流程整理成" +
  "读者可直接跟做的分步教程(第二人称、每步带界面动作与输入内容、保留关键数字)," +
  "不做「视频演示了…」式转述;推荐框架其余小节照常。";

/**
 * 内容形式预置(2026-10-18 体裁治理;2026-10-20 详情页重构收编为写作配置
 * 「内容形式」维度,可视化构建器见 writing-config.ts):user-facing 形式 =
 * 定位模板 + 生成话术体裁词 + 绑定技能,落库走 positioning(模板文本)+
 * skillKey 回写(M39 批②服务端单点派生,见 writing-config#deriveSkillKey),
 * 零 schema 变更。两个既有视频形式继续挂 blogger-video 指南(教程写法是指南
 * 内分支);M39 扩容 5 个非视频形式各挂专属 skill(批④种子落库前 agent 侧
 * list_skills 兜底,见 topic-tools 绑定降级)。扩展新形式=加一项,指南侧补
 * 对应 skill + writing-config 补样例。
 */
export type TopicPurposeKey =
  | "video-recommend"
  | "video-tutorial"
  | "open-source-intro"
  | "paper-interpret"
  | "tutorial-refine"
  | "weekly-news"
  | "model-pricing";

export const TOPIC_PURPOSES: readonly {
  key: TopicPurposeKey;
  label: string;
  genreWord: string;
  positioningTemplate: string;
  /** 生成初稿绑定的 agent_skill key(服务端从 positioning 单点派生回写) */
  skillKey: string;
}[] = [
  {
    key: "video-recommend",
    label: "视频安利",
    genreWord: "视频安利稿",
    positioningTemplate: DEFAULT_TOPIC_POSITIONING,
    skillKey: "blogger-video",
  },
  {
    key: "video-tutorial",
    label: "视频安利+文字版教程",
    genreWord: "视频安利稿·含文字版教程",
    positioningTemplate: TUTORIAL_TOPIC_POSITIONING,
    skillKey: "blogger-video",
  },
  {
    key: "open-source-intro",
    label: "开源项目介绍",
    genreWord: "开源项目介绍稿",
    positioningTemplate:
      "围绕「这个项目解决什么问题、凭什么值得上手」来选材:优先带出核心机制、" +
      "与同类项目的关键差异和真实上手体验;给出可复现的最小上手路径,不写官方 README 复读。",
    skillKey: "open-source-intro",
  },
  {
    key: "paper-interpret",
    label: "论文解读",
    genreWord: "论文解读稿",
    positioningTemplate:
      "围绕「这篇论文回答了什么问题、结论改变了什么」来选材:优先讲清方法直觉与" +
      "关键实验数据,弱化公式推导;点明局限与适用边界,像给同行做口头报告,不做逐节翻译。",
    skillKey: "paper-interpret",
  },
  {
    key: "tutorial-refine",
    label: "教程精炼",
    genreWord: "教程精炼稿",
    positioningTemplate:
      "本篇素材为教程/实操内容:整理成读者可直接跟做的精炼教程——步骤只留必要动作" +
      "与输入,关键参数与坑位提示就地标注;前置「准备清单」,不做背景故事铺垫。",
    skillKey: "tutorial-refine",
  },
  {
    key: "weekly-news",
    label: "周新闻精选",
    genreWord: "周新闻精选稿",
    positioningTemplate:
      "本篇为一周新闻精选综述:按主题分组收编本周最重要的 AI 动态,每条一句话讲清" +
      "「发生了什么+为什么值得在意」;开头给三行速览,结尾点出下周值得跟踪的一件事。",
    skillKey: "weekly-news",
  },
  {
    key: "model-pricing",
    label: "模型价格表",
    genreWord: "模型价格表稿",
    positioningTemplate:
      "本篇为模型价格速查:以表格为主干整理各模型的输入/输出牌价与免费额度,标注" +
      "计价单位与数据截稿日期;只做客观比对与选购建议,不臆测未公布的定价。",
    skillKey: "model-pricing",
  },
];

/** 定位文本 → 撰写目的(模板精确匹配;空=未设置按缺省「视频安利」;
 * 自定义文案返回 null,UI 显示「自定义」且切目的时不覆盖) */
export function matchTopicPurpose(positioning: string | null): TopicPurposeKey | null {
  const p = (positioning ?? "").trim();
  if (p === "") return "video-recommend";
  return TOPIC_PURPOSES.find((t) => t.positioningTemplate === p)?.key ?? null;
}

/**
 * 状态机(方案 §3/§10-7):collecting→drafted 仅由 compose 驱动;published 钩子
 * 回写;下架/解绑人工回退。publish 钩子允许 collecting→published(人工直接
 * 关联文章发布的旁路,不经合成)。
 */
const ALLOWED_TRANSITIONS: Record<TopicStatus, readonly TopicStatus[]> = {
  collecting: ["drafted", "published"],
  drafted: ["collecting", "published"],
  published: ["drafted"],
};

export function canTransition(from: TopicStatus, to: TopicStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
