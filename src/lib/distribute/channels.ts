/**
 * 内容分发渠道常量与纯工具(M17 批①,requirement §4 多渠道分发):
 * 渠道框架插件式——channel 字段中立(一期仅 wechat,CSDN/知乎/掘金后置),
 * 状态/上限/工具在弹窗与列表组件也要用,本文件禁服务端 import(客户端安全)。
 */

export const CHANNEL_WECHAT = "wechat";
/** 渠道合法值(应用层 Zod 管控,arch/03 枚举演进条款) */
export const PUBLISH_CHANNELS = [CHANNEL_WECHAT] as const;

export const PUBLISH_STATUS_PENDING = "pending";
export const PUBLISH_STATUS_SYNCED = "synced";
export const PUBLISH_STATUS_FAILED = "failed";
export const PUBLISH_CHANNEL_STATUSES = [
  PUBLISH_STATUS_PENDING,
  PUBLISH_STATUS_SYNCED,
  PUBLISH_STATUS_FAILED,
] as const;

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
