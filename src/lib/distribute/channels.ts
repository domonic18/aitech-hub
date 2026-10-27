/**
 * 内容分发渠道常量与纯工具(M17 批①,requirement §4 多渠道分发):
 * 渠道框架插件式——channel 字段中立(一期仅 wechat,CSDN/知乎/掘金后置),
 * 状态/上限/工具在弹窗与列表组件也要用,本文件禁服务端 import(客户端安全)。
 */

export const CHANNEL_WECHAT = "wechat";
/** 贴图载体渠道:小红书(M49 定稿,属 contentPinChannel;与文章侧 PUBLISH_CHANNELS 分离) */
export const CHANNEL_XHS = "xiaohongshu";
/** 渠道合法值(应用层 Zod 管控,arch/03 枚举演进条款)。M49 定稿:文章载体只分发公众号——
 * 小红书属贴图载体(contentPinChannel),不入本枚举 */
export const PUBLISH_CHANNELS = [CHANNEL_WECHAT] as const;

/** 分发载体(M50 批A):文章侧走 publish_channel,贴图侧走 content_pin_channel */
export const DISTRIBUTE_CARRIERS = ["article", "pin"] as const;
export type DistributeCarrier = (typeof DISTRIBUTE_CARRIERS)[number];

/** 渠道注册表 v2(M50 批A:加载体维度+收编小红书,原 M48 批D 转活)——分发中心
 * 读侧渠道枚举校验/渠道名/载体归因的唯一源。键域=双载体全渠道;文章侧管线
 * (publish_channel 表与队列路由)键域仍锁 PUBLISH_CHANNELS。carriers=该渠道
 * 可挂的载体(wechat 双载体都有——文章与贴图各有公众号同步;行级载体归因
 * 看记录来源表,见 records.ts PublishRecordRow.carrier)。 */
export const DISTRIBUTE_CHANNELS: Record<
  typeof CHANNEL_WECHAT | typeof CHANNEL_XHS,
  { label: string; carriers: DistributeCarrier[] }
> = {
  [CHANNEL_WECHAT]: { label: "微信公众号", carriers: ["article", "pin"] },
  [CHANNEL_XHS]: { label: "小红书", carriers: ["pin"] },
};

/** 渠道参数校验(读侧唯一口):合法返回渠道名,非法/缺省返回 undefined(不过滤)。
 * 双载体全放行——xiaohongshu 的记录在 content_pin_channel,读侧按 carrier 路由
 * 查询(批B),publishChannel 表无此渠道行属预期。 */
export function parseChannelParam(
  raw: string | undefined,
): keyof typeof DISTRIBUTE_CHANNELS | undefined {
  if (!raw) return undefined;
  return raw in DISTRIBUTE_CHANNELS
    ? (raw as keyof typeof DISTRIBUTE_CHANNELS)
    : undefined;
}

export const PUBLISH_STATUS_PENDING = "pending";
export const PUBLISH_STATUS_SYNCED = "synced";
export const PUBLISH_STATUS_FAILED = "failed";
export const PUBLISH_CHANNEL_STATUSES = [
  PUBLISH_STATUS_PENDING,
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
