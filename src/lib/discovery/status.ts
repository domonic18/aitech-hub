/**
 * 发现治理台状态常量(M25 批③):词库/候选的状态枚举、分段白名单、标签与
 * 分页口径。纯常量无服务端依赖——页面(RSC)、API 路由与客户端组件共用,
 * 防状态字面量漂移(同 feedback-schema 口径)。
 */

/** 词库状态:pending=联想回灌待定;active=生效参与发现轮;dismissed=人工弃用;
 *  merged=已并入已有词作别名(F24 候选治理合并,命中统计随目标词) */
export const KEYWORD_STATUSES = ["pending", "active", "dismissed", "merged"] as const;
export type KeywordStatus = (typeof KEYWORD_STATUSES)[number];

export const KEYWORD_STATUS_LABELS: Record<KeywordStatus, string> = {
  pending: "待定",
  active: "生效",
  dismissed: "已弃用",
  merged: "已并入",
};

/** 词库列表分段(tab 白名单,parseListSegment 消费) */
export const KEYWORD_LIST_SEGMENTS = ["all", "pending", "active", "dismissed"] as const;
export type KeywordListSegment = (typeof KEYWORD_LIST_SEGMENTS)[number];

/** 候选终审状态:pending=待审;approved/rejected=人工终审结论(机器刷新不回退) */
export const CANDIDATE_STATUSES = ["pending", "approved", "rejected"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  pending: "待审",
  approved: "已批准",
  rejected: "已驳回",
};

export const CANDIDATE_LIST_SEGMENTS = ["all", "pending", "approved", "rejected"] as const;
export type CandidateListSegment = (typeof CANDIDATE_LIST_SEGMENTS)[number];

/** 候选类型标签(表内 type 为自由串,缺省回落原值) */
export const CANDIDATE_TYPE_LABELS: Record<string, string> = {
  blogger: "博主",
  video: "视频",
};

/** 治理台顶层 tab:一屏一表,共用 status/page 参数 */
export const DISCOVERY_TABS = ["candidates", "keywords"] as const;
export type DiscoveryTab = (typeof DISCOVERY_TABS)[number];

export const DISCOVERY_PAGE_SIZE = 20;

/** 词长上界(VarChar(100)):客户端表单 maxLength 与服务端归一校验同源 */
export const WORD_MAX_LEN = 100;
