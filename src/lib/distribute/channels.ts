/**
 * 内容分发渠道常量与纯工具(M17 批①,requirement §4 多渠道分发):
 * 渠道框架插件式——channel 字段中立(一期仅 wechat,CSDN/知乎/掘金后置),
 * 状态/上限/工具在弹窗与列表组件也要用,本文件禁服务端 import(客户端安全)。
 */

export const CHANNEL_WECHAT = "wechat";
export const CHANNEL_XHS = "xiaohongshu";
/** 渠道合法值(应用层 Zod 管控,arch/03 枚举演进条款;xhs 特有数据行内 data JSON) */
export const PUBLISH_CHANNELS = [CHANNEL_WECHAT, CHANNEL_XHS] as const;

/** 渠道注册表(M48 批D 转活:原 PUBLISH_CHANNELS 零消费方死脚手架)——分发中心
 * 读侧渠道枚举校验/渠道名的唯一源。新渠道(小红书等)在此登记即获得:校验放行、
 * overview/listPublishChannelRecords 的 channel 维度、分发页渠道名;同步管线
 * 按 queue.ts#distributeQueueFor 落子队列。Record 键域锁 PUBLISH_CHANNELS,
 * 加渠道漏登记 label 编译期即红。 */
export const DISTRIBUTE_CHANNELS: Record<(typeof PUBLISH_CHANNELS)[number], { label: string }> = {
  [CHANNEL_WECHAT]: { label: "微信公众号" },
  [CHANNEL_XHS]: { label: "小红书" },
};

/** 渠道参数校验(读侧唯一口):合法返回渠道名,非法/缺省返回 undefined(不过滤) */
export function parseChannelParam(
  raw: string | undefined,
): (typeof PUBLISH_CHANNELS)[number] | undefined {
  if (!raw) return undefined;
  return (PUBLISH_CHANNELS as readonly string[]).includes(raw)
    ? (raw as (typeof PUBLISH_CHANNELS)[number])
    : undefined;
}

export const PUBLISH_STATUS_PENDING = "pending";
/** 物料就绪待人工发布(M49 批X2 小红书半自动:AI 改写完成,等人工粘贴发布) */
export const PUBLISH_STATUS_READY = "ready";
export const PUBLISH_STATUS_SYNCED = "synced";
export const PUBLISH_STATUS_FAILED = "failed";
export const PUBLISH_CHANNEL_STATUSES = [
  PUBLISH_STATUS_PENDING,
  PUBLISH_STATUS_READY,
  PUBLISH_STATUS_SYNCED,
  PUBLISH_STATUS_FAILED,
] as const;

/** 公众号同步状态展示词单源(M47 批A':行内按钮/产出卡/贴图详情/配置卡五处
 * 曾各自表述且已漂移——草箱/草稿箱、同步失败/失败;统一「草稿箱」全称口径) */
export const PUBLISH_STATUS_LABELS: Record<string, string> = {
  pending: "待同步",
  synced: "已同步草稿箱",
  failed: "同步失败",
};

/** 同步动作按钮文案(pending=进行态;已同步给重试话术,其余/未同步过 null
 * 首次同步;两处按钮曾逐字重复三元链) */
export function wechatSyncActionLabel(status: string | null): string {
  if (status === PUBLISH_STATUS_PENDING) return "同步中";
  return status === PUBLISH_STATUS_SYNCED ? "重新同步" : "同步公众号";
}

/** 公众号图文标题上限(字;弹窗按码点预校验,精确计数口径待官方核验) */
export const WECHAT_TITLE_MAX = 64;
/** 公众号图文摘要上限(字;超限接口报错,弹窗拦截 + payload clamp 双保险) */
export const WECHAT_DIGEST_MAX = 120;
/** 草稿 content HTML 长度预算(码点;超限报错不截断,精确值待官方核验) */
export const WECHAT_CONTENT_MAX_CHARS = 20000;
/** 批量同步单 job 上限(篇;防误选全库,30×~15s ≈ 8min < worker lockDuration 900s) */
export const DISTRIBUTE_BATCH_MAX = 30;
/** 批量逐篇间隔(ms;草稿接口频控保护,精确限额待官方核验,真机调) */
export const WECHAT_SYNC_GAP_MS = 1500;
/** 正文文末 References 条数上限(超出只染色不编号,防撑爆 content 长度预算) */
export const WECHAT_REFERENCE_MAX = 20;
/** 图文 author 缺省(公众号作者字段;config.author 空时管道取此值) */
export const WECHAT_DEFAULT_AUTHOR = "一起AI";

export const DISTRIBUTE_PAT_DENY = "PAT must not manage content distribution";

/** 摘要截断:按码点截(汉字一个码点;String.length 会把代理对算 2) */
export function clampDigest(text: string, max: number = WECHAT_DIGEST_MAX): string {
  return [...text].length <= max ? text : [...text].slice(0, max).join("");
}
