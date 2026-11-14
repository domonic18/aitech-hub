/**
 * 创作侧总闸(M72 瘦身 B0):站内 AI 生成(创作中心 / deepagents 写侧)的熔断开关。
 *
 * 存 site_config kv(键族 creation.*,同「通用底座」纪律:value 一律字符串,
 * 消费方解析;缺行 → 缺省值)。语义与 agent-limits 同款,但**刻意不走
 * site-config 的 React cache 包装**:熔断闸要「改配置即生效」,不能等缓存。
 *
 * 缺省语义:缺行 = 开(=现状,站内创作可用);只有显式存关值才关。理由是
 * 缺行多见于「从未配置」,而误关的代价（站内创作全线不可用）远大于误开。
 */
import { prisma } from "../db";
import { prerenderSafe } from "../prerender-safe";

export const CREATION_FLAG_KEYS = {
  /** 站内 AI 生成总闸:false → admin 侧拿不到任何写工具,只剩只读问答 */
  agentEnabled: "creation.agent_enabled",
} as const;

/** 关态字面量(运维手填容错:true/false、0/1、on/off 都认) */
const OFF_VALUES = new Set(["false", "0", "off", "no"]);

/**
 * 站内 AI 生成是否开启(缺行/非法 → 开)。
 * 关时:admin 侧只装配只读六件工具、只给基础系统提示 —— 创作入口的按钮
 * 还在(B3 才下线 UI),但工具面已无写能力,点了也只能问答。
 */
export async function isCreationAgentEnabled(): Promise<boolean> {
  const raw = await prerenderSafe(
    `site_config.${CREATION_FLAG_KEYS.agentEnabled}`,
    null,
    async () => {
      const row = await prisma.siteConfig.findUnique({
        where: { key: CREATION_FLAG_KEYS.agentEnabled },
        select: { value: true },
      });
      return row?.value ?? null;
    },
  );
  if (raw === null) return true;
  return !OFF_VALUES.has(raw.trim().toLowerCase());
}
