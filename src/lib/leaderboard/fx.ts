/**
 * 美元 → 人民币汇率(M63 v2.1 榜单价格双币展示):单一 site_config kv 键存
 * {rate,date,source},每日由 worker 定时采集一次,公开页读侧只读不采。
 *
 * 口径声明:定价模块的既定立场是「货币不做汇率折算」;榜单这里的人民币仅是
 * **展示折算**(上游 AA 原始口径固定 USD / 1M tokens),页面上必须标注折算与日期,
 * 不得据此反推报价。
 *
 * 键走遥测快照路径(同 distribute.xhs_state 先例):不进后台设置页、不过
 * SiteConfigUpdateSchema;库缺行/值损坏/越界一律回落默认汇率并标 isFallback,
 * 页面提示「暂取默认值」而不是报错。
 */
import { cache } from "react";

import { formatCnDate } from "@/lib/datetime";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { fetchViaEgress } from "@/lib/net/egress-fetch";
import { prerenderSafe } from "@/lib/prerender-safe";

import { revalidateLeaderboardPage } from "./revalidate";

/** site_config 键(非设置项:每日遥测快照) */
export const FX_RATE_KEY = "leaderboard.usd_cny_rate";
/** 取数端点:免费无密钥、北京时间每日更新;境内直连不稳时由 fetchViaEgress 走系统出口 */
export const FX_RATE_URL = "https://open.er-api.com/v6/latest/USD";
/** 从未采到/值损坏时的展示汇率 */
export const FX_RATE_FALLBACK = 7.2;
/** 汇率出处(页面价款旁可点开核对,展示口径不藏来源) */
export const FX_RATE_SOURCE_URL = "https://open.er-api.com/";
/** 合理区间:越界说明接口契约变了或返回了脏值,宁可用旧值也不落库 */
export const FX_RATE_MIN = 3;
export const FX_RATE_MAX = 15;
const FX_FETCH_TIMEOUT_MS = 15_000;
const CRAWLER_UA = "aitech-hub-crawler/0.1 (+https://17aitech.com)";

export interface UsdCnyRate {
  /** 1 USD = rate CNY */
  rate: number;
  /** 汇率生效日(YYYY-MM-DD);从未采到 → null */
  date: string | null;
  /** 来源标识;从未采到 → null */
  source: string | null;
  /** true = 从未采到/值损坏,rate 是默认值而非实采 */
  isFallback: boolean;
}

/** 落库载荷(与 UsdCnyRate 的 isFallback 无关:能落库的一定是实采值) */
interface StoredRate {
  rate: number;
  date: string;
  source: string;
}

function validRate(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= FX_RATE_MIN && v <= FX_RATE_MAX;
}

/** er-api 载荷 → 落库值;契约不符(或汇率越界)返回 null,调用侧据此不落库 */
export function parseUsdCnyRatePayload(
  payload: unknown,
  now: Date = new Date(),
): StoredRate | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (p.result !== "success" || p.base_code !== "USD") return null;
  const rates = p.rates;
  if (typeof rates !== "object" || rates === null) return null;
  const cny = (rates as Record<string, unknown>).CNY;
  if (!validRate(cny)) return null;
  // 生效日优先取接口自报时间,缺/非法则记采集日(北京日界,与页面「数据截至」同口径)
  const updated =
    typeof p.time_last_update_utc === "string" ? new Date(p.time_last_update_utc) : null;
  const date =
    updated !== null && !Number.isNaN(updated.getTime())
      ? formatCnDate(updated)
      : formatCnDate(now);
  return { rate: Number(cny.toFixed(4)), date, source: "open.er-api.com" };
}

/** kv 值(JSON 串)→ 展示汇率;缺失/损坏/越界一律回落默认并标 isFallback */
export function readStoredRate(raw: string | null): UsdCnyRate {
  if (raw !== null) {
    try {
      const v = JSON.parse(raw) as Record<string, unknown>;
      if (validRate(v.rate)) {
        return {
          rate: v.rate,
          date: typeof v.date === "string" ? v.date : null,
          source: typeof v.source === "string" ? v.source : null,
          isFallback: false,
        };
      }
    } catch {
      // 坏值按从未采到处理,下次采集覆盖
    }
  }
  return { rate: FX_RATE_FALLBACK, date: null, source: null, isFallback: true };
}

/** 当前展示汇率(请求内 cache 去重;构建期无库 → 默认值) */
export const getUsdCnyRate = cache((): Promise<UsdCnyRate> =>
  prerenderSafe("leaderboard.fx_rate", readStoredRate(null), readCurrentRate),
);

/** 读库当前汇率(无 React cache、无 prerenderSafe 兜底;worker/读侧共用) */
async function readCurrentRate(): Promise<UsdCnyRate> {
  const row = await prisma.siteConfig.findUnique({
    where: { key: FX_RATE_KEY },
    select: { value: true },
  });
  return readStoredRate(row?.value ?? null);
}

/** 陈旧判定:从未采到,或落库日早于「24 小时前」的北京日。
 * 容差来源:er-api 每日 00:00 UTC(= 北京 08:00)更新,凌晨采集拿到的仍是前一北京日的值,
 * 若按「不等于今天」判定,每日 04:43 的定时采集永远算陈旧、每次 worker 重启都白跑一次。 */
export function isStaleRate(stored: UsdCnyRate, now: Date = new Date()): boolean {
  if (stored.isFallback || stored.date === null) return true;
  const toleranceDay = formatCnDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  return stored.date < toleranceDay;
}

/**
 * 启动补偿(worker 引导阶段调用):定时采集在 04:43,而新部署/首次上线的 worker
 * 在此之前是没有汇率行的——页面会一直用默认值 7.2 折算到下一个凌晨。此处只在
 * 「从未采到 / 已陈旧」时补采一次;失败只告警(定时任务仍是兜底,页面读旧值不报错)。
 */
export async function ensureUsdCnyRate(now: Date = new Date()): Promise<UsdCnyRate> {
  const current = await readCurrentRate();
  if (!isStaleRate(current, now)) return current;
  try {
    const refreshed = await refreshUsdCnyRate(now);
    // 汇率变了,页面上的折算价得跟着换:失效一次榜单页(启动期 web 未就绪只是告警,
    // 页面最迟由 ISR 窗口 / 下一次采集兜底)
    await revalidateLeaderboardPage();
    return refreshed;
  } catch (e) {
    logger.warn({
      event: "leaderboard.fx_ensure_failed",
      error: e instanceof Error ? e.message : String(e),
    });
    return current;
  }
}

/** 每日采集(worker 定时任务):失败上抛由 job 台账记账,不吞错;页面读旧值不受影响 */
export async function refreshUsdCnyRate(now: Date = new Date()): Promise<UsdCnyRate> {
  const res = await fetchViaEgress(FX_RATE_URL, {
    method: "GET",
    headers: { accept: "application/json", "user-agent": CRAWLER_UA },
    signal: AbortSignal.timeout(FX_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`汇率接口 HTTP ${String(res.status)}`);
  const parsed = parseUsdCnyRatePayload(await res.json(), now);
  if (parsed === null) throw new Error("汇率接口契约不符,沿用上一次汇率");
  const value = JSON.stringify(parsed);
  await prisma.siteConfig.upsert({
    where: { key: FX_RATE_KEY },
    update: { value },
    create: { key: FX_RATE_KEY, value },
  });
  logger.info({ event: "leaderboard.fx_refreshed", rate: parsed.rate, date: parsed.date });
  return { ...parsed, isFallback: false };
}
