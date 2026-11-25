/**
 * 场景价(P4):把不同计价单位(raw/秒/分钟/张)统一到一组固定 workload,
 * 让用户在列表/比价里直接看到「跑这个场景要多少钱」。
 *
 * 纪律:
 * - 纯函数、零库零 env,可进 client chunk(与 public.ts 同);
 * - 原币直出,不做汇率折算(D4);
 * - 不兼容单位或缺价返回 null,不臆测;
 * - 默认 scenario="off" 时返回 null,保持现有表格不变。
 */
import { isTokenPriced, type PublicModelRow } from "./public";

export type PricingScenarioId =
  "off" | "text-1M-tokens" | "image-100-images-1K" | "video-10s-1080P";

export interface PricingScenario {
  id: PricingScenarioId;
  label: string;
  /** 价格格后缀,如 "/1M tokens" */
  suffix: string;
  /** token 场景:输入 token 数 */
  inputTokens?: number;
  /** token 场景:输出 token 数 */
  outputTokens?: number;
  /** 图像场景:张数 */
  imageCount?: number;
  /** 视频场景:秒数 */
  videoSeconds?: number;
}

export const SCENARIOS: ReadonlyArray<PricingScenario> = [
  { id: "off", label: "默认(单价)", suffix: "" },
  {
    id: "text-1M-tokens",
    label: "文本 · 1M tokens",
    suffix: "/1M tokens",
    inputTokens: 500_000,
    outputTokens: 500_000,
  },
  {
    id: "image-100-images-1K",
    label: "图像 · 100 张 1K",
    suffix: "/100张",
    imageCount: 100,
  },
  {
    id: "video-10s-1080P",
    label: "视频 · 10 秒 1080P",
    suffix: "/10秒",
    videoSeconds: 10,
  },
];

const SCENARIO_BY_ID: Record<PricingScenarioId, PricingScenario> = Object.fromEntries(
  SCENARIOS.map((s) => [s.id, s]),
) as Record<PricingScenarioId, PricingScenario>;

/** 场景 ID 合法化;非法值回落 "off" */
export function normalizeScenarioId(raw: string | null): PricingScenarioId {
  if (raw === null) return "off";
  const found = SCENARIOS.find((s) => s.id === raw);
  return found?.id ?? "off";
}

/**
 * 给定行在指定场景下的总成本。
 * - token 行:(inputPrice * inputTokens + outputPrice * outputTokens) / 1_000_000
 * - 按张:outputPrice * 张数
 * - 按秒/分钟:outputPrice(分钟先 ÷60) * 秒数
 * - 不兼容单位/缺价/未选场景 → null
 */
export function scenarioCost(
  row: Pick<PublicModelRow, "priceUnit" | "inputPrice" | "outputPrice">,
  scenarioId: PricingScenarioId,
): number | null {
  if (scenarioId === "off") return null;
  const scenario = SCENARIO_BY_ID[scenarioId];
  if (isTokenPriced(row)) {
    const { inputTokens, outputTokens } = scenario;
    if (inputTokens === undefined || outputTokens === undefined) return null;
    const input = row.inputPrice ?? 0;
    const output = row.outputPrice ?? 0;
    return (input * inputTokens + output * outputTokens) / 1_000_000;
  }
  if (row.priceUnit === "per_image") {
    const count = scenario.imageCount;
    if (count === undefined || row.outputPrice === null) return null;
    return row.outputPrice * count;
  }
  if (row.priceUnit === "per_second" || row.priceUnit === "per_minute") {
    const seconds = scenario.videoSeconds;
    if (seconds === undefined || row.outputPrice === null) return null;
    const perSecond = row.priceUnit === "per_minute" ? row.outputPrice / 60 : row.outputPrice;
    return perSecond * seconds;
  }
  return null;
}

/** 场景价展示:"¥ 12.5/100张" / "$ 0.8/1M tokens";null=未公布 */
export function formatScenarioCost(
  cost: number | null,
  currency: string,
  scenarioId: PricingScenarioId,
): string {
  if (cost === null) return "—";
  const suffix = SCENARIO_BY_ID[scenarioId]?.suffix ?? "";
  const symbol = currency === "USD" ? "$" : "¥";
  return `${symbol} ${cost}${suffix}`;
}

/** 场景下拉选项(含 off) */
export function scenarioOptions(): ReadonlyArray<{ id: PricingScenarioId; label: string }> {
  return SCENARIOS.map((s) => ({ id: s.id, label: s.label }));
}
