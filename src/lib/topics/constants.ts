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
