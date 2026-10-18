/**
 * 专题内容管线常量(M26,方案锚 docs/plan/topic-pipeline-plan.md):
 * 状态机/素材类型一处收敛;合法值应用层 Zod 管控(arch/03 枚举演进条款)。
 */

export const TOPIC_STATUS = ["collecting", "drafted", "published"] as const;
export type TopicStatus = (typeof TOPIC_STATUS)[number];

export const TOPIC_STATUS_LABEL: Record<TopicStatus, string> = {
  collecting: "收集中",
  drafted: "已合成",
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
 * 撰写目的预置(2026-10-18 体裁治理,post-319 验收反馈「合成话术写死推荐
 * 体裁,教程意图无入口」):user-facing 目的 = 定位模板 + 合成话术体裁词,
 * 落库仍走 positioning(模板文本),零 schema 变更。两个目的同走 blogger-video
 * 指南(教程写法是指南内分支),绑定技能一律自动匹配。扩展新目的=加一项
 * (label/genreWord/positioningTemplate),指南侧补对应写法分支。
 */
export type TopicPurposeKey = "video-recommend" | "video-tutorial";

export const TOPIC_PURPOSES: readonly {
  key: TopicPurposeKey;
  label: string;
  genreWord: string;
  positioningTemplate: string;
}[] = [
  {
    key: "video-recommend",
    label: "视频安利",
    genreWord: "视频安利稿",
    positioningTemplate: DEFAULT_TOPIC_POSITIONING,
  },
  {
    key: "video-tutorial",
    label: "视频安利+文字版教程",
    genreWord: "视频安利稿·含文字版教程",
    positioningTemplate: TUTORIAL_TOPIC_POSITIONING,
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
