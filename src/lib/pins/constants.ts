/**
 * 贴图域常量(M41 渠道三,plan M41):状态机/上限/裁剪档一处收敛;
 * 合法值应用层 Zod 管控(arch/03 枚举演进条款)。上限对齐公众号
 * draft/add newspic 契约(spike 实证,2026-10-22):
 * 标题 ≤32 字、content 纯文本 ≤2 万码点、image_list ≤20 张(首张即封面)。
 */

export const PIN_STATUS = ["draft", "pending", "synced", "published"] as const;
export type PinStatus = (typeof PIN_STATUS)[number];

/** 状态展示名(列表页签/组装台步进条/徽标同源,讲用户语言) */
export const PIN_STATUS_LABEL: Record<PinStatus, string> = {
  draft: "草稿",
  pending: "待验收",
  synced: "已同步(公众号草稿箱)",
  published: "已发布",
};

/** 列表分段白名单(全部 + 四态;?status= 解析用) */
export const PIN_LIST_SEGMENTS = ["all", ...PIN_STATUS] as const;

/** 可编辑状态域(「已同步/已发布须先撤回待验收」规则单源;repo 编辑锁与
 * agent 加图闸同用,此前同规则正反两式三处手写) */
export const PIN_EDITABLE_STATUSES = ["draft", "pending"] as const;
export function isPinEditable(status: string): boolean {
  return (PIN_EDITABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * 人工可驱动的状态迁移(组装台/工作台钮组与 API 文档口径同源):
 * draft→pending 提交验收;pending→draft 撤回继续组装;pending→published
 * 站点直接上架(公众号渠道可后补);synced→published 发布;synced→pending
 * 撤回再编辑(重新同步后回到已同步);published→pending 下架修改。
 */
export const PIN_MANUAL_TARGETS: Record<PinStatus, readonly PinStatus[]> = {
  draft: ["pending"],
  pending: ["draft", "published"],
  synced: ["published", "pending"],
  published: ["pending"],
};

/** 标题码点上限(公众号 newspic 硬上限 32 字,超字无法保存草稿) */
export const PIN_TITLE_MAX = 32;
/** 轻文字码点硬上限(公众号 newspic content 纯文本 ≤2 万) */
export const PIN_CONTENT_MAX = 20000;
/** 轻文字 UI 建议软帽(超限仅提示不拦截;小绿书阅读场景宜短) */
export const PIN_CONTENT_SOFT_MAX = 1000;
/** 图片序列上限(公众号 image_list ≤20 张) */
export const PIN_IMAGES_MAX = 20;
/** 封面裁剪档(公众号 cover_info.crop_percent_list 三选一,同步时随 draft/add;
 * 值域以官方 newspic 文档为准 1_1/16_9/2.35_1——旧值 2.35_9 系笔误已勘误) */
export const PIN_CROP_SPECS = ["1_1", "16_9", "2.35_1"] as const;
export type PinCropSpec = (typeof PIN_CROP_SPECS)[number];

/** 渠道一期仅 wechat(复用 distribute 渠道常量,字段中立同款) */
export { CHANNEL_WECHAT as PIN_CHANNEL_WECHAT } from "../distribute/channels";

/** 贴图列表分页大小(工作台网格一屏 12 的倍数,3:4 卡四列) */
export const PIN_LIST_PAGE_SIZE = 12;

/** 前台 /pins 瀑布流分页大小(四列 × 6 行) */
export const PIN_SITE_PAGE_SIZE = 24;
