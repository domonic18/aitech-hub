/**
 * AI 智能指数:数据库读侧
 * 从 ai_index_daily 读取每日指数,供首页卡片与 /ai-index 看板使用。
 *
 * 构建期无 DB(CI/镜像构建),取数经 prerenderSafe 降级为空数据(arch/07-frontend §1);
 * 运行时错误照常上抛,不静默返空。
 */
import { prisma } from "@/lib/db";
import { prerenderSafe } from "@/lib/prerender-safe";

export interface AiIndexDailyRow {
  date: string; // YYYY-MM-DD
  capability: number | null;
  velocity: number;
  acceleration: number;
  intelligenceIndex: number;
  eventCount: number;
  topEvents: unknown;
  dimensions: unknown;
}

function toRow(r: {
  date: Date;
  capability: number | null;
  velocity: number;
  acceleration: number;
  intelligenceIndex: number;
  eventCount: number;
  topEvents: unknown;
  dimensions: unknown;
}): AiIndexDailyRow {
  return {
    date: r.date.toISOString().slice(0, 10),
    capability: r.capability,
    velocity: r.velocity,
    acceleration: r.acceleration,
    intelligenceIndex: r.intelligenceIndex,
    eventCount: r.eventCount,
    topEvents: r.topEvents,
    dimensions: r.dimensions,
  };
}

/** 最近 N 天的指数序列(默认 90 天) */
export async function listAiIndexDaily(days = 90): Promise<AiIndexDailyRow[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  return prerenderSafe("ai_index.list", [], async () => {
    const rows = await prisma.aiIndexDaily.findMany({
      where: { date: { gte: since } },
      orderBy: { date: "asc" },
    });
    return rows.map(toRow);
  });
}

/** 首页卡片:最近 30 天 + 最新一条 */
export async function getAiIndexCardData(): Promise<{
  recent: AiIndexDailyRow[];
  latest: AiIndexDailyRow | null;
}> {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  since.setHours(0, 0, 0, 0);

  return prerenderSafe("ai_index.card", { recent: [], latest: null }, async () => {
    const [recent, latest] = await Promise.all([
      prisma.aiIndexDaily.findMany({
        where: { date: { gte: since } },
        orderBy: { date: "asc" },
      }),
      prisma.aiIndexDaily.findFirst({ orderBy: { date: "desc" } }),
    ]);

    return {
      recent: recent.map(toRow),
      latest: latest ? toRow(latest) : null,
    };
  });
}

/** 聚合维度分布(按全部有数据日期) */
export async function getAiIndexDimensionCounts(): Promise<Record<string, number>> {
  const rows = await prisma.aiIndexDaily.findMany({
    select: { dimensions: true },
  });
  return rows.reduce(
    (acc, r) => {
      const dims = r.dimensions as Record<string, number> | null;
      if (!dims) return acc;
      for (const [k, v] of Object.entries(dims)) {
        acc[k] = (acc[k] ?? 0) + (typeof v === "number" ? v : 0);
      }
      return acc;
    },
    {} as Record<string, number>,
  );
}
