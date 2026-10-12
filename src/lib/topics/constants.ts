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
