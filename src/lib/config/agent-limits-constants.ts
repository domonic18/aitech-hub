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

/** 默认档(= 硬编码时代 2026-10-17 放宽值;缺行/构建期回落);
 * 2026-10-20 富 HTML 改造:一篇文章 = 素材/指南 + 写作 + 1~2 轮自审 + 3~5 张卡
 * (含重试) + 两段封面 HITL,80 次无重试余量;tokens 同调 600k(大 HTML 卡
 * 单次 8~12k token,多轮累积) */
export const DEFAULT_AGENT_LIMITS: Record<AgentLimitKind, AgentLimitsConfig> = {
  guest: { toolCalls: 12, tokens: 50_000 },
  user: { toolCalls: 12, tokens: 50_000 },
  admin: { toolCalls: 120, tokens: 600_000 },
};

/** 合法域(三档同域;admin 长编排实测 80/400k→120/600k,上限留足余量) */
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
