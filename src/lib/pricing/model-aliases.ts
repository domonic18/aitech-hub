/**
 * 型号别名表(牌价改造 P1,2026-11-25):**源作用域**的型号异写覆盖,
 * 只收「通用能力剥离(canon.ts)覆盖不到」的跨源异写。
 *
 * 与 provider-registry.ts 的 PROVIDER_SEEDS/VENDOR_KEY_ALIASES 同风格:
 * TS 常量作单一出处(别名是型号知识,低频变动、走 PR 评审),零运行时开销。
 * 接源超过十余家、别名上千条、或运营需要自维护时,再升级 DB 表 +
 * 后台维护,本表降级为种子(方案 D2)。
 *
 * 收录判据:同一型号在两个源的键,经 canon 通用剥离后 base 仍不同 → 一条。
 * 别忘了配套 canon.test.ts 的钉死用例。
 */
export interface ModelAliasRule {
  /** 源 providerKey(聚合源=平台 key;别名只在源内生效,防跨源误并) */
  providerKey: string;
  /** 源内模型原始键(采集页原文,精确匹配) */
  rawKey: string;
  /** 覆盖基型(缺省沿用通用剥离结果) */
  base?: string;
  /** 覆盖任务词(缺省沿用通用结果) */
  task?: string;
}

export const MODEL_ALIASES: readonly ModelAliasRule[] = [
  // 词元所模型市场用裸版本号,爱诗科技即 PixVerse(与百炼 pixverse-v6-t2v 同型)
  { providerKey: "baidu-ciyuansuo", rawKey: "v6", base: "pixverse-v6" },
  { providerKey: "baidu-ciyuansuo", rawKey: "v5.6", base: "pixverse-v5.6" },
];

/** 命中的别名规则;无则 null */
export function aliasRuleOf(
  providerKey: string | null | undefined,
  rawKey: string,
): ModelAliasRule | null {
  if (!providerKey) return null;
  const trimmed = rawKey.trim();
  return MODEL_ALIASES.find((r) => r.providerKey === providerKey && r.rawKey === trimmed) ?? null;
}
