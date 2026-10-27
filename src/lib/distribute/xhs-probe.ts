/**
 * 小红书登录态每日探照(M50 批F):worker 每日 cron 调 xhs-gateway /xhs/state,
 * 结果落 site_config kv(distribute.xhs_state)——分发中心渠道卡 RSC 直读,
 * Cookie 过期早知道(此前只会在发布 failed 后被动发现)。三态语义:
 * loggedIn true=有效 / false=失效(请重贴 Cookie)/ null=探照不可达
 * (gateway 宕机/超时,≠Cookie 过期,不误报)。
 */
import { z } from "zod";

import { prisma } from "../db";
import { logger } from "../logger";
import { SITE_CONFIG_KEYS } from "../config/site-config";

/** 登录态快照(gateway /xhs/state 投影;snake_case 为网关契约原形) */
export interface XhsStateSnapshot {
  storage_state_ready: boolean;
  logged_in: boolean | null;
  error?: string;
}

/** 探针取数(web 实时路由与 worker 定时共用;探针必须可答,异常归一不抛) */
export async function fetchXhsState(): Promise<XhsStateSnapshot> {
  const base = process.env.DOUYIN_GATEWAY_URL ?? "http://douyin-gateway:8010";
  try {
    const res = await fetch(`${base}/xhs/state`, {
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return {
      storage_state_ready: data?.["storage_state_ready"] === true,
      logged_in: typeof data?.["logged_in"] === "boolean" ? data["logged_in"] : null,
      ...(data?.["error"] ? { error: String(data["error"]) } : {}),
    };
  } catch (e) {
    return {
      storage_state_ready: false,
      logged_in: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

const ProbeRecord = z.object({
  checkedAt: z.string(), // ISO
  loggedIn: z.boolean().nullable(),
  storageReady: z.boolean(),
  error: z.string().nullable(),
});

export type XhsProbeRecord = z.infer<typeof ProbeRecord>;

/** 每日探照(worker 消费):取数 + 落 kv;任何异常只 warn 不抛
 * (探照是锦上添花,不得污染 distribute 队列的失败计数) */
export async function runXhsStateProbe(): Promise<XhsProbeRecord> {
  const snap = await fetchXhsState();
  const record: XhsProbeRecord = {
    checkedAt: new Date().toISOString(),
    loggedIn: snap.logged_in,
    storageReady: snap.storage_state_ready,
    error: snap.error ?? null,
  };
  await prisma.siteConfig.upsert({
    where: { key: SITE_CONFIG_KEYS.distributeXhsState },
    update: { value: JSON.stringify(record) },
    create: { key: SITE_CONFIG_KEYS.distributeXhsState, value: JSON.stringify(record) },
  });
  logger.info({
    event: "xhs.state_probed",
    loggedIn: record.loggedIn,
    storageReady: record.storageReady,
    error: record.error,
  });
  return record;
}

/** 渠道卡读侧:最近一次探照记录(未探测过 → null,卡面显「未探测」) */
export async function getXhsLastProbe(): Promise<XhsProbeRecord | null> {
  const row = await prisma.siteConfig
    .findUnique({
      where: { key: SITE_CONFIG_KEYS.distributeXhsState },
      select: { value: true },
    })
    .catch(() => null);
  if (!row?.value) return null;
  try {
    const parsed = ProbeRecord.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null; // kv 被异构写入/损坏 → 视同未探测,不阻塞渠道卡
  }
}
