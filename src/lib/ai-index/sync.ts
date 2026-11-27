/**
 * AI 智能指数·能力层写侧
 *
 * 职责:把上游 ECI 数据落库(逐模型真相源 + 拉取台账),并保证「坏数据进不来、
 * 好数据不重复写、失败留痕」。
 *
 * 口径:
 * - 每次拉取写**一行**台账(ai_index_eci_sync):ok / no_change / rejected / failed;
 * - rejected(校验闸门拒收)与 failed(下载或解析失败)都不动模型表,旧数据继续服务;
 * - 内容指纹取**解析后模型行的规范化哈希**(epoch-source#hashEciModels)——
 *   换行/空白/行序差异不算变更,只有模型数据真变了才判「变了」。
 */
import { prisma } from "@/lib/db";
import { logError, logInfo, logWarn } from "@/lib/logger";

import { epochEciModels } from "./epoch-data";
import {
  computeEciFrontier,
  fetchEpochDataset,
  validateEciDataset,
  type EciModel,
} from "./epoch-source";

export type EciSyncStatus = "ok" | "no_change" | "rejected" | "failed";

export interface EciSyncResult {
  status: EciSyncStatus;
  modelCount: number;
  changedModels: number;
  frontierEci: number | null;
  contentHash: string | null;
  reason?: string;
}

interface EciModelRow {
  model: string;
  displayName: string;
  eci: number;
  ciLow: number;
  ciHigh: number;
  date: string;
  organization: string;
  country: string | null;
  accessibility: string | null;
  accessibilityGroup: string | null;
  sourceHash: string;
}

function toRow(m: EciModel, sourceHash: string): EciModelRow {
  return {
    model: m.model,
    displayName: m.displayName,
    eci: m.eci,
    ciLow: m.ciLow,
    ciHigh: m.ciHigh,
    date: m.date,
    organization: m.organization,
    country: m.country === "" ? null : m.country,
    accessibility: m.accessibility === "" ? null : m.accessibility,
    accessibilityGroup: m.accessibilityGroup === "" ? null : m.accessibilityGroup,
    sourceHash,
  };
}

/** 库内现状:模型总数 + 前沿 ECI + 上次成功同步的内容指纹 */
async function loadPrevState(): Promise<{
  modelCount: number;
  frontierEci: number;
  contentHash: string | null;
}> {
  const [count, max, lastOk] = await Promise.all([
    prisma.aiIndexEciModel.count(),
    prisma.aiIndexEciModel.aggregate({ _max: { eci: true } }),
    prisma.aiIndexEciSync.findFirst({
      where: { status: "ok" },
      orderBy: { fetchedAt: "desc" },
      select: { contentHash: true },
    }),
  ]);
  return {
    modelCount: count,
    frontierEci: max._max.eci ?? 0,
    contentHash: lastOk?.contentHash ?? null,
  };
}

async function writeLedger(row: {
  status: EciSyncStatus;
  httpStatus?: number | null;
  contentHash?: string | null;
  modelCount?: number | null;
  frontierEci?: number | null;
  changedModels?: number | null;
  durationMs?: number | null;
  error?: string | null;
}): Promise<void> {
  await prisma.aiIndexEciSync.create({
    data: {
      status: row.status,
      httpStatus: row.httpStatus ?? null,
      contentHash: row.contentHash ?? null,
      modelCount: row.modelCount ?? null,
      frontierEci: row.frontierEci ?? null,
      changedModels: row.changedModels ?? null,
      durationMs: row.durationMs ?? null,
      error: row.error ?? null,
    },
  });
}

/** 全量 upsert(快照语义):返回实际变更行数 */
async function upsertModels(models: EciModel[], sourceHash: string): Promise<number> {
  const existing = await prisma.aiIndexEciModel.findMany({
    select: {
      model: true,
      displayName: true,
      eci: true,
      ciLow: true,
      ciHigh: true,
      eciDate: true,
      organization: true,
      country: true,
      accessibility: true,
      accessibilityGroup: true,
    },
  });
  const before = new Map(existing.map((r) => [r.model, r]));

  let changed = 0;
  const ops = models.map((m) => {
    const row = toRow(m, sourceHash);
    const prev = before.get(m.model);
    const eciDate = new Date(`${row.date}T00:00:00Z`);
    if (
      prev !== undefined &&
      prev.eci === row.eci &&
      prev.ciLow === row.ciLow &&
      prev.ciHigh === row.ciHigh &&
      prev.displayName === row.displayName &&
      prev.organization === row.organization &&
      prev.country === row.country &&
      prev.accessibility === row.accessibility &&
      prev.accessibilityGroup === row.accessibilityGroup &&
      prev.eciDate.getTime() === eciDate.getTime()
    ) {
      // 内容没变:只补 source_hash(便于追批次),不动分数
      return prisma.aiIndexEciModel.update({
        where: { model: row.model },
        data: { sourceHash },
      });
    }
    changed += 1;
    return prisma.aiIndexEciModel.upsert({
      where: { model: row.model },
      create: {
        model: row.model,
        displayName: row.displayName,
        eci: row.eci,
        ciLow: row.ciLow,
        ciHigh: row.ciHigh,
        eciDate,
        organization: row.organization,
        country: row.country,
        accessibility: row.accessibility,
        accessibilityGroup: row.accessibilityGroup,
        sourceHash,
      },
      update: {
        displayName: row.displayName,
        eci: row.eci,
        ciLow: row.ciLow,
        ciHigh: row.ciHigh,
        eciDate,
        organization: row.organization,
        country: row.country,
        accessibility: row.accessibility,
        accessibilityGroup: row.accessibilityGroup,
        sourceHash,
      },
    });
  });

  await prisma.$transaction(ops);
  return changed;
}

/**
 * 拉上游 → 校验 → 落库 → 写台账。
 * 失败路径也会留台账行;闸门拒收(rejected)同样上抛,让 job_run 记 failed——
 * 上游数据不可信是需要人看一眼的事,不该静默通过。
 */
export async function syncEciFromUpstream(): Promise<EciSyncResult> {
  const startedAt = Date.now();
  let ledgerWritten = false;
  try {
    const ds = await fetchEpochDataset();
    const prev = await loadPrevState();

    const validation = validateEciDataset(
      ds.models,
      prev.modelCount > 0 ? { modelCount: prev.modelCount, frontierEci: prev.frontierEci } : null,
    );
    if (!validation.ok) {
      await writeLedger({
        status: "rejected",
        httpStatus: ds.httpStatus,
        contentHash: ds.contentHash,
        modelCount: ds.models.length,
        durationMs: Date.now() - startedAt,
        error: validation.reason,
      });
      ledgerWritten = true;
      logWarn("ai_index.eci_rejected", { reason: validation.reason, modelCount: ds.models.length });
      throw new Error(`ECI 数据未通过校验:${validation.reason}`);
    }

    const frontier = computeEciFrontier(ds.models);
    const frontierEci = frontier.length > 0 ? frontier[frontier.length - 1].eci : null;

    if (prev.contentHash !== null && prev.contentHash === ds.contentHash) {
      await writeLedger({
        status: "no_change",
        httpStatus: ds.httpStatus,
        contentHash: ds.contentHash,
        modelCount: ds.models.length,
        frontierEci,
        changedModels: 0,
        durationMs: Date.now() - startedAt,
      });
      ledgerWritten = true;
      logInfo("ai_index.eci_fetch", {
        status: "no_change",
        modelCount: ds.models.length,
        frontierEci,
        durationMs: Date.now() - startedAt,
      });
      return {
        status: "no_change",
        modelCount: ds.models.length,
        changedModels: 0,
        frontierEci,
        contentHash: ds.contentHash,
      };
    }

    const changed = await upsertModels(ds.models, ds.contentHash);
    await writeLedger({
      status: "ok",
      httpStatus: ds.httpStatus,
      contentHash: ds.contentHash,
      modelCount: ds.models.length,
      frontierEci,
      changedModels: changed,
      durationMs: Date.now() - startedAt,
    });
    ledgerWritten = true;
    logInfo("ai_index.eci_fetch", {
      status: "ok",
      modelCount: ds.models.length,
      changedModels: changed,
      frontierEci,
      durationMs: Date.now() - startedAt,
    });
    return {
      status: "ok",
      modelCount: ds.models.length,
      changedModels: changed,
      frontierEci,
      contentHash: ds.contentHash,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!ledgerWritten) {
      await writeLedger({
        status: "failed",
        durationMs: Date.now() - startedAt,
        error: message,
      }).catch((le: unknown) =>
        logError("ai_index.eci_ledger_failed", {
          error: le instanceof Error ? le.message : String(le),
        }),
      );
    }
    logError("ai_index.eci_fetch_failed", { error: message });
    throw e;
  }
}

/**
 * 冷启动播种:表空时用仓库快照(src/lib/ai-index/epoch-data.ts)补一底。
 * 只在「表完全没有数据」时跑一次,之后由每日同步接管。
 */
export async function seedEciFromSnapshot(): Promise<{ seeded: boolean; count: number }> {
  const count = await prisma.aiIndexEciModel.count();
  if (count > 0) return { seeded: false, count };

  const models: EciModel[] = epochEciModels.map((m) => ({
    model: m.model,
    displayName: m.displayName,
    eci: m.eci,
    ciLow: m.ciLow,
    ciHigh: m.ciHigh,
    date: m.date,
    organization: m.organization,
    country: m.country,
    accessibility: m.accessibility,
    accessibilityGroup: m.accessibilityGroup,
  }));
  await upsertModels(models, "seed");
  logInfo("ai_index.eci_seeded", { count: models.length });
  return { seeded: true, count: models.length };
}
