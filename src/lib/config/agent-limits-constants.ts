/**
 * Agent 额度配置的**纯**部分(档位/默认值/合法域/键名/recursion 派生)。
 *
 * ⚠️ 本模块必须保持**零 import**(与 lib/site-meta、lib/constants 同一条纪律):
 * 后台表单 SiteSettingsForm 是客户端组件,直接取这里的常量与类型;而读写侧
 * `agent-limits.ts` 链到 `../db` → `../env`(模块级 zod 校验 + PrismaClient),
 * 一旦客户端从那边取值,整个 env 校验就会被打进 client chunk,浏览器里
 * `process.env.DATABASE_URL` 缺失直接抛错、页面白屏
 * (2026-11-01 生产事故:站点设置页 client-side exception,根因即 db.ts 改为
 * `env.NODE_ENV` 后被这条客户端链带进 bundle)。
 */

/** 身份档(与 AgentIdentity["kind"] 同域;字面量防 config→agent 反向依赖) */
export const AGENT_LIMIT_KINDS = ["guest", "user", "admin"] as const;
export type AgentLimitKind = (typeof AGENT_LIMIT_KINDS)[number];

/** 单档额度(次/tokens;recursion 派生不入库) */
export interface AgentLimitsConfig {
  toolCalls: number;
  tokens: number;
}

/**
 * 默认档(缺行/构建期回落)。
 *
 * M72 瘦身 B5/D11(2026-11-15):agent 写侧整体下线后,工具面塌缩为全员只读
 * 六件 —— 一次问答是「检索 + 读几篇正文」的短链路,admin 档原先为「一篇文章
 * = 素材/指南 + 写作 + 1~2 轮自审 + 3~5 张卡 + 两段封面 HITL」留的 120/600k
 * 长编排预算不再有消费方,故 admin 降到与 user 同档(12/50k)——既回到真实的
 * 用量口径,也直接压低单次 run 的服务端负担(用户瘦身的原始动机之一)。
 *
 * **2026-11-17 上调 50k → 500k(站长裁定)**:50k 是**写侧时代**的数(一次 run
 * 写一篇长文)。只读六件上线后实测:一次追问 = 4 次模型调用,每轮把「历史 +
 * 工具结果」全量重发,真实消耗 4.8 万 tokens —— **一轮就吃掉会话预算的
 * 96%**,run 被护栏腰斩、计划条任务一个都没跑完(生产复现,逐帧计数
 * 7 212 → 10 501 → 14 023 → 15 917,累加 48 487)。护栏口径已同期拆成
 * 「单次调用闸 / 单轮闸 / 会话累计闸」三道(见 lib/agent/guard.ts),预算上调
 * 后一轮问答只占会话预算约 10%,追问多轮不再被腰斩。
 */
export const DEFAULT_AGENT_LIMITS: Record<AgentLimitKind, AgentLimitsConfig> = {
  guest: { toolCalls: 12, tokens: 500_000 },
  user: { toolCalls: 12, tokens: 500_000 },
  admin: { toolCalls: 12, tokens: 500_000 },
};

/**
 * 单次模型调用闸(内部门槛,不入后台配置):任一次模型调用的 prompt+completion
 * 上限。防「长会话的 prompt 一路涨到不可用」——读侧暂不做上下文瘦身,长会话
 * 的 prompt 会随历史线性增长,需要一道上限把「单次过大」与「用量超预算」
 * 两种收束分开报,便于用户判断是「开新会话」还是「等一会儿」。
 */
export const AGENT_CALL_TOKENS_LIMIT = 96_000;

/** 合法域(三档同域;上限留足余量,后台可调) */
export const TOOL_CALLS_MIN = 1;
export const TOOL_CALLS_MAX = 200;
export const TOKENS_MIN = 1_000;
export const TOKENS_MAX = 2_000_000;

/** KV 键登记(agent.<kind>.<field>;site_config 表,消费方经常量取键) */
export const AGENT_LIMIT_KEYS: Record<AgentLimitKind, { toolCalls: string; tokens: string }> = {
  guest: { toolCalls: "agent.guest.tool_calls", tokens: "agent.guest.tokens" },
  user: { toolCalls: "agent.user.tool_calls", tokens: "agent.user.tokens" },
  admin: { toolCalls: "agent.admin.tool_calls", tokens: "agent.admin.tokens" },
};

/** recursionLimit 派生:2.5×toolCalls 四舍五入,硬夹 16..500(防极小/极大档) */
export function deriveRecursionLimit(toolCalls: number): number {
  return Math.max(16, Math.min(500, Math.round(toolCalls * 2.5)));
}
