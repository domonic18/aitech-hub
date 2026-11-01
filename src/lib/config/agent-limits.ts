/**
 * Agent 调用额度配置(2026-10-17 验收反馈:护栏不再硬编码,后台「站点设置」
 * 可调)。存 site_config kv(键族 agent.*,同「通用底座」纪律:value 一律
 * 字符串,消费方解析+clamp;缺行/非法回默认)。recursionLimit 不开放设置——
 * 按 2.5×toolCalls 派生(与历史默认 12→30、80→200 完全一致):护栏步数与
 * 递归兜底必须同步放大(run.ts docblock),派生消掉「配小 recursion 中途
 * 断流」的脚枪。读侧:run 路由每请求一次 findMany(热路径随即开 LLM 流,
 * 单键索引查询开销可忽略)。
 *
 * 档位/默认值/合法域等**纯**常量住 `agent-limits-constants.ts`(客户端组件直接取,
 * 见该文件头注),本模块只留读写侧并原样再导出,服务端消费面不变。
 */
import { z } from "zod";

import { prisma } from "../db";
import {
  AGENT_LIMIT_KEYS,
  AGENT_LIMIT_KINDS,
  DEFAULT_AGENT_LIMITS,
  deriveRecursionLimit,
  TOKENS_MAX,
  TOKENS_MIN,
  TOOL_CALLS_MAX,
  TOOL_CALLS_MIN,
  type AgentLimitKind,
  type AgentLimitsConfig,
} from "./agent-limits-constants";

export * from "./agent-limits-constants";

function clampInt(n: number, fallback: number, min: number, max: number): number {
  if (!Number.isInteger(n) || n < min) return fallback;
  return Math.min(max, n);
}

// ── 读侧 ──────────────────────────────────────────────────────

/** 三档全量读(单次 findMany;缺行/非法 → 默认;run 路由与设置页共用) */
export async function getAgentLimitsAll(): Promise<Record<AgentLimitKind, AgentLimitsConfig>> {
  const keys = Object.values(AGENT_LIMIT_KEYS).flatMap((k) => [k.toolCalls, k.tokens]);
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<AgentLimitKind, AgentLimitsConfig>;
  for (const kind of AGENT_LIMIT_KINDS) {
    const def = DEFAULT_AGENT_LIMITS[kind];
    const k = AGENT_LIMIT_KEYS[kind];
    const tcRaw = byKey.get(k.toolCalls);
    const tkRaw = byKey.get(k.tokens);
    out[kind] = {
      toolCalls:
        tcRaw === undefined
          ? def.toolCalls
          : clampInt(Number(tcRaw), def.toolCalls, TOOL_CALLS_MIN, TOOL_CALLS_MAX),
      tokens:
        tkRaw === undefined
          ? def.tokens
          : clampInt(Number(tkRaw), def.tokens, TOKENS_MIN, TOKENS_MAX),
    };
  }
  return out;
}

/** 单档 run 闸(额度 + 派生 recursion;runAgentTurn 入参形状) */
export function toRunLimits(cfg: AgentLimitsConfig): {
  toolCalls: number;
  tokens: number;
  recursion: number;
} {
  return { ...cfg, recursion: deriveRecursionLimit(cfg.toolCalls) };
}

// ── 写侧 ──────────────────────────────────────────────────────

/** PUT 请求体(六键扁平 optional;越界/非法由 Zod 先行拒绝,路由层给 400 文案) */
export const AgentLimitsUpdateSchema = z.object({
  guestToolCalls: z.number().int().min(TOOL_CALLS_MIN).max(TOOL_CALLS_MAX).optional(),
  guestTokens: z.number().int().min(TOKENS_MIN).max(TOKENS_MAX).optional(),
  userToolCalls: z.number().int().min(TOOL_CALLS_MIN).max(TOOL_CALLS_MAX).optional(),
  userTokens: z.number().int().min(TOKENS_MIN).max(TOKENS_MAX).optional(),
  adminToolCalls: z.number().int().min(TOOL_CALLS_MIN).max(TOOL_CALLS_MAX).optional(),
  adminTokens: z.number().int().min(TOKENS_MIN).max(TOKENS_MAX).optional(),
});

export type AgentLimitsUpdateInput = z.infer<typeof AgentLimitsUpdateSchema>;

/** 保存(partial 多键一次事务 upsert;与站点键共表互不感知) */
export async function setAgentLimits(input: AgentLimitsUpdateInput): Promise<void> {
  const entries: Array<[string, number | undefined]> = [
    [AGENT_LIMIT_KEYS.guest.toolCalls, input.guestToolCalls],
    [AGENT_LIMIT_KEYS.guest.tokens, input.guestTokens],
    [AGENT_LIMIT_KEYS.user.toolCalls, input.userToolCalls],
    [AGENT_LIMIT_KEYS.user.tokens, input.userTokens],
    [AGENT_LIMIT_KEYS.admin.toolCalls, input.adminToolCalls],
    [AGENT_LIMIT_KEYS.admin.tokens, input.adminTokens],
  ];
  const rows = entries
    .filter((e): e is [string, number] => e[1] !== undefined)
    .map(([key, value]) => ({ key, value: String(value) }));
  if (rows.length === 0) return;
  await prisma.$transaction(
    rows.map((r) =>
      prisma.siteConfig.upsert({ where: { key: r.key }, update: { value: r.value }, create: r }),
    ),
  );
}
