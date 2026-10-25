/**
 * F20 引擎卡/F19 监控的 crawler 队列运行态读取(M48 批E 自 channel-ledger 拆出,
 * ≤350 行红线):活跃/等待视频 job → 账号/平台归并、「● 采集中」时钟起点。
 * 纯读侧,BullMQ + prisma。
 */
import { prisma } from "../db";
import { CRAWL_JOB_VIDEO, QUEUE_CRAWLER, getQueue } from "../queue";

/** crawler 活跃视频 job → 账号 → 最早 processedOn(「● 采集中 mm:ss」时钟起点;
 *  渠道台账按平台归并,F27 博主台账按账号直用) */
export async function videoRunningAccounts(): Promise<Map<number, number>> {
  const active = await getQueue(QUEUE_CRAWLER).getActive(0, 20);
  const out = new Map<number, number>();
  for (const j of active) {
    if (j.name !== CRAWL_JOB_VIDEO) continue;
    const accountId = (j.data as { accountId?: number }).accountId;
    if (typeof accountId !== "number") continue;
    const at = j.processedOn ?? j.timestamp;
    if (typeof at !== "number") continue;
    const known = out.get(accountId);
    if (known === undefined || at < known) out.set(accountId, at);
  }
  return out;
}

/** crawler 活跃视频 job → 平台 → 最早 processedOn(F17 平台行与 F21 计划社媒行共用) */
export async function videoRunningSince(): Promise<Map<string, number>> {
  const byAccount = await videoRunningAccounts();
  if (byAccount.size === 0) return new Map();
  const accounts = await prisma.socialAccount.findMany({
    where: { id: { in: [...byAccount.keys()] } },
    select: { id: true, platform: true },
  });
  const out = new Map<string, number>();
  for (const a of accounts) {
    const at = byAccount.get(a.id);
    if (at === undefined) continue;
    const known = out.get(a.platform);
    if (known === undefined || at < known) out.set(a.platform, at);
  }
  return out;
}

/** F20 引擎卡当前采集:crawler 队列活跃 job 逐条(文字渠道带渠道名,视频
 *  job 反查博主名;时钟起点 processedOn ?? timestamp) */
export async function crawlerActiveRuns(): Promise<
  Array<{ id: string; label: string; kind: "rss" | "video"; sinceMs: number }>
> {
  const active = await getQueue(QUEUE_CRAWLER).getActive(0, 20);
  const out: Array<{ id: string; label: string; kind: "rss" | "video"; sinceMs: number }> = [];
  const accountIds: number[] = [];
  const rows: Array<{
    id: string;
    label: string | null;
    kind: "rss" | "video";
    sinceMs: number;
    accountId?: number;
  }> = [];
  for (const j of active) {
    const data = (j.data ?? {}) as { sourceName?: string; sourceId?: number; accountId?: number };
    const sinceMs = typeof j.processedOn === "number" ? j.processedOn : (j.timestamp ?? Date.now());
    if (j.name === CRAWL_JOB_VIDEO) {
      if (typeof data.accountId !== "number") continue;
      accountIds.push(data.accountId);
      rows.push({ id: j.id ?? "", label: null, kind: "video", sinceMs, accountId: data.accountId });
    } else {
      rows.push({
        id: j.id ?? "",
        label: data.sourceName ?? (data.sourceId != null ? `渠道 #${data.sourceId}` : j.name),
        kind: "rss",
        sinceMs,
      });
    }
  }
  if (accountIds.length > 0) {
    const accounts = await prisma.socialAccount.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, nickname: true },
    });
    const nameOf = new Map(accounts.map((a) => [a.id, a.nickname]));
    for (const r of rows) {
      if (r.kind === "video") r.label = nameOf.get(r.accountId ?? -1) ?? "博主";
    }
  }
  for (const r of rows)
    out.push({ id: r.id, label: r.label ?? r.id, kind: r.kind, sinceMs: r.sinceMs });
  return out;
}

/** F20 按博主排队:crawler 队列 waiting 视频 job → accountId 计数 */
export async function videoWaitingAccounts(): Promise<Map<number, number>> {
  const waiting = await getQueue(QUEUE_CRAWLER).getWaiting(0, 100);
  const out = new Map<number, number>();
  for (const j of waiting) {
    if (j.name !== CRAWL_JOB_VIDEO) continue;
    const accountId = (j.data as { accountId?: number }).accountId;
    if (typeof accountId !== "number") continue;
    out.set(accountId, (out.get(accountId) ?? 0) + 1);
  }
  return out;
}
