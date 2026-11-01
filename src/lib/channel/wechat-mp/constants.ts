/**
 * 公众号私信问答(M66)常量与 Redis 键契约单源。
 *
 * 数值全部来自平台硬约束(plan/wechat-mp-bot-plan §1.2):
 * - 被动回复 5s 硬窗口 → 等待预算 4.2s、轮询 100ms;
 * - 文本 2048 **字节** 且打满会静默失败 → 出站一律按 1800 字节截断;
 * - 事件无 MsgId,幂等键见 crypto.parseInbound。
 */

/** 被动回复等待预算(5s 平台窗口留 0.8s 给网络与渲染) */
export const WECHAT_MP_WAIT_BUDGET_MS = 4_200;
/** 结果键轮询间隔 */
export const WECHAT_MP_POLL_INTERVAL_MS = 100;
/** 「继续」取结果的短轮询预算(用户往往在超时回执后立刻发「继续」,
 *  此时答案常仍在生成;继续请求同样吃 5s 平台窗口,留 1.6s 余量) */
export const WECHAT_MP_CONTINUE_POLL_BUDGET_MS = 3_400;
/** 出站文本字节上限(2048 打满会静默失败,留余量) */
export const WECHAT_MP_REPLY_MAX_BYTES = 1_800;
/** 答案缓存 TTL(用户回「继续」的回捞窗口) */
export const WECHAT_MP_REPLY_TTL_SECONDS = 30 * 60;
/** 一次性绑定码 TTL(站点生成 → 公众号发出) */
export const WECHAT_MP_BIND_TTL_SECONDS = 10 * 60;
/** 消息明细保留天数(worker 日清) */
export const WECHAT_MP_RETENTION_DAYS = 180;
/** 绑定码长度与字符集(剔除 0O1lI 易混字符) */
export const WECHAT_MP_BIND_CODE_LENGTH = 8;
export const WECHAT_MP_BIND_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** 答案引用的站内文章条数上限(字节预算内) */
export const WECHAT_MP_MAX_CITATIONS = 2;
/** 入站文本长度上限(超出视为刷屏,不检索不生成) */
export const WECHAT_MP_MAX_QUERY_CHARS = 500;

/** 「继续」回捞触发词(去空白后全等匹配) */
export const WECHAT_MP_CONTINUE_WORDS = ["继续", "继续获取", "继续吧"] as const;
/** 帮助触发词(半角/全角问号各一) */
export const WECHAT_MP_HELP_WORDS = ["帮助", "help", "?", "？", "怎么用"] as const;
/** 默认转人工触发词(后台可覆盖) */
export const WECHAT_MP_DEFAULT_HANDOFF_KEYWORDS = [
  "人工",
  "客服",
  "联系站长",
  "商务合作",
  "转载",
] as const;

/** 敏感词拦截使用的 blocklist scope 见 lib/telegram/constants(与 comment 同款扩值) */

/** 话术默认值(plan §7;后台可覆盖,空串回落此处) */
export const WECHAT_MP_DEFAULT_TEXTS = {
  greeting:
    "你好,我是一起AI(17aitech.com)的助手。直接问 AI 相关问题即可,答案优先取自站内文章并附出处。回复「人工」可转站长。",
  fallback:
    "站内暂时没有找到能直接回答这个问题的内容。可以换个说法再问,或到站内搜索:https://17aitech.com/search 。需要人工协助请回复「人工」。",
  /** 系统错误(检索/模型/队列任何一环失败)——与「没找到」区分,避免误导用户改问法 */
  error: "这个问题暂时没处理成功(服务繁忙),请稍后重发一次。需要人工协助请回复「人工」。",
  timeout: "【答案正在生成,请稍等几秒后回复「继续」获取】",
  continueEmpty: "暂时没有待继续的答复,直接发送你的问题即可。",
  continuePending: "答案还在生成中,请再过几秒回复「继续」。",
  handoff: "已记录你的问题,站长会尽快处理;可以继续补充细节。",
  blocked: "这个问题我无法回答,可以换个话题。",
  help: "发送问题即可。回复「继续」取上一条未完成的答复;回复「人工」转站长。",
  bindOk: "绑定成功。之后你在站内的账号会与这个公众号关联。",
  bindFail: "绑定码无效或已过期,请到站点「我的 → 账号设置」重新生成。",
  tooLong: "问题太长了,请精简到 500 字以内再发一次。",
} as const;

/** 出站回复类型(落 channel_wechat_mp_message.reply_kind) */
export type WechatMpReplyKind =
  | "welcome"
  | "keyword"
  | "rag"
  | "timeout"
  | "continue"
  | "handoff"
  | "fallback"
  | "help"
  | "blocked"
  | "bind"
  | "unsupported";

/** 答案状态(落 channel_wechat_mp_message.answer_status) */
export type WechatMpAnswerStatus = "ok" | "no_evidence" | "error" | "truncated" | "blocked";

/** job 名(队列名 `QUEUE_WECHAT_MP` 单源在 lib/queue.ts,入 QUEUE_NAMES;
 *  队列名/jobId 禁冒号,分隔符一律连字符) */
export const WECHAT_MP_JOB_ANSWER = "answer";
export const WECHAT_MP_JOB_PURGE = "purge";
/** 每日清理 cron 单源在 lib/collect/schedules(调度注册表同步登记) */

/** Redis 键(表外状态;均带 TTL,不落库) */
export const wechatMpKeys = {
  /** 待继续指针:`channel:wxmp:pending:<openid>` → msgId */
  pending: (openid: string): string => `channel:wxmp:pending:${openid}`,
  /** 在途答案指针:`channel:wxmp:active:<openid>` → msgId(入队即写,
   *  让「继续」在答案尚未生成完时知道该等哪一条而不是回「没有待继续」) */
  active: (openid: string): string => `channel:wxmp:active:${openid}`,
  /** 答案缓存:`channel:wxmp:reply:<msgId>` → JSON{text,kind,status} */
  reply: (msgId: string): string => `channel:wxmp:reply:${msgId}`,
  /** 一次性绑定码:`channel:wxmp:bind:<code>` → userId */
  bind: (code: string): string => `channel:wxmp:bind:${code}`,
  /** 当日答案计数:`channel:wxmp:quota:<YYYY-MM-DD>` */
  quota: (day: string): string => `channel:wxmp:quota:${day}`,
} as const;

/**
 * BullMQ jobId(幂等:一条入站消息只算一次)。
 *
 * 用落库消息 id(纯数字)而非入站的 `dedupeKey`——后者形如 `msg:<MsgId>`,
 * 而 BullMQ 自定义 jobId **禁止冒号**(实测抛 `Custom Id cannot contain :`,
 * 入队即失败,整条 L1 链路被静默降级成系统错误话术)。
 */
export function wechatMpAnswerJobId(messageId: bigint | string): string {
  return `wxmp-${messageId.toString()}`;
}
