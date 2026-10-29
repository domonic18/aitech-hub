/**
 * 站点专题注册表(A1 专题聚合,2026-10-29):/topics/ 索引页与 Header
 * 「专题」二级下拉共用此清单——新增专题 = 加一项(页面 + 导航同步)。
 * 单一真相源,防两处漂移。
 */
export interface SiteTopic {
  /** 导航/卡片标题 */
  label: string;
  /** 专题页路径(终态 URL,SEO 已收录) */
  href: string;
  /** 卡片简介(topics 索引页用) */
  desc: string;
  /** 卡片角标(topics 索引页用) */
  tag: string;
}

export const SITE_TOPICS: readonly SiteTopic[] = [
  {
    label: "模型价格速查",
    href: "/pricing/",
    desc: "主流大模型官方牌价一觉:输入/输出价、免费额度与上下文窗口,Coding Plan 套餐额度口径。官方一手价人工核对,USD 原币直出,持续更新。",
    tag: "价格速查",
  },
];
