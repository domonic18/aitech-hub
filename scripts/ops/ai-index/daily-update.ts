/**
 * AI 智能指数:日终更新脚本
 *
 * 流程:电报流可见条目 → 相关性闸(只留 AI 相关)→ 打分(impact/方向/置信度)
 *      → 净冲击聚合 + 百分位冲击分 → 与 Epoch ECI 能力基线合成智能指数
 *      → upsert ai_index_daily
 *
 * 长期运维脚本(npm run ai-index:update),不进入 worker。
 */
import { prisma } from "@/lib/db";
import { capabilityBaseAt } from "@/lib/ai-index/capability";
import { scoreNewsItems, selectAiRelevant, signedImpact } from "@/lib/ai-index/score";
import { sampleNewsItems } from "@/lib/ai-index/sample-news";
import { buildImpactSeries, computeAcceleration } from "@/lib/ai-index/velocity";

const FORCE_SAMPLE = process.env.AI_INDEX_FORCE_SAMPLE === "true";
const LOOKBACK_DAYS = Number(process.env.AI_INDEX_LOOKBACK_DAYS ?? "90");
const MAX_ITEMS = Number(process.env.AI_INDEX_MAX_ITEMS ?? "300");

/** 智能指数 = 能力基线 + 冲击加成(上限 +PULSE_BONUS 分,脉冲 = 冲击分百分位 / 100) */
const PULSE_BONUS = Number(process.env.AI_INDEX_PULSE_BONUS ?? "5");

interface TopEvent {
  title: string;
  url: string;
  score: number;
  signed: number;
  dimension: string;
  direction: string;
  relevance: string;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchTelegramItems(): Promise<
  {
    id: string;
    title: string;
    summary: string;
    url: string;
    publishedAt: string;
    sourceName?: string;
  }[]
> {
  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);
  since.setHours(0, 0, 0, 0);

  const rows = await prisma.telegram.findMany({
    where: {
      status: "visible",
      publishedAt: { gte: since },
    },
    select: {
      id: true,
      title: true,
      summary: true,
      aiSummary: true,
      url: true,
      publishedAt: true,
      source: { select: { name: true } },
    },
    orderBy: { publishedAt: "desc" },
    take: MAX_ITEMS,
  });

  return rows.map((r) => ({
    id: r.id.toString(),
    title: r.title ?? r.summary.slice(0, 100),
    summary: r.aiSummary ?? r.summary,
    url: r.url,
    publishedAt: (r.publishedAt ?? new Date()).toISOString(),
    sourceName: r.source?.name,
  }));
}

function shiftSampleDatesToRecent(items: typeof sampleNewsItems): typeof sampleNewsItems {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const sorted = [...items].sort(
    (a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime(),
  );
  const spanDays = 30;
  return sorted.map((item, i) => {
    const daysAgo = Math.round((1 - i / (sorted.length - 1)) * spanDays);
    const shifted = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    return { ...item, publishedAt: shifted.toISOString() };
  });
}

function computeIntelligenceIndex(
  capabilityBase: number | null,
  impactIndex: number | null,
): number {
  if (capabilityBase === null) return 0;
  const pulse = (impactIndex ?? 0) / 100;
  return Number((capabilityBase + PULSE_BONUS * pulse).toFixed(2));
}

async function main(): Promise<void> {
  // 1. 取新闻:示例集只在本机演示时显式开启(AI_INDEX_FORCE_SAMPLE=true),
  //    生产环境不回落示例数据——电报流为空就是为空,不留假数据
  const rawItems = FORCE_SAMPLE
    ? shiftSampleDatesToRecent(sampleNewsItems)
    : await fetchTelegramItems();
  const source = FORCE_SAMPLE ? "sample" : "telegram";

  if (rawItems.length === 0) {
    console.log("No news items to process.");
    return;
  }
  console.log(`Processing ${rawItems.length} items from ${source}`);

  // 2. 打分(优先 Jev,失败回落规则)
  const scored = await scoreNewsItems(rawItems);
  console.log(`Scored ${scored.length} items`);

  // 3. 相关性闸:非 AI 资讯直接丢弃
  const relevant = selectAiRelevant(scored);
  const dropped = scored.length - relevant.length;
  console.log(`AI relevant ${relevant.length}, dropped ${dropped} non-AI items`);

  // 4. 聚合:净冲击 → 7 日平滑 → 滚动窗口百分位(冲击分)
  const series = buildImpactSeries(relevant);
  const acceleration = computeAcceleration(series);

  // 5. 逐日合成智能指数
  const rows = series.map((point, i) => {
    const dayStart = new Date(`${point.date}T00:00:00Z`);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const dayItems = relevant.filter((item) => {
      const d = new Date(item.publishedAt);
      return d >= dayStart && d < dayEnd;
    });

    const dayEvents = [...dayItems]
      .sort((a, b) => Math.abs(signedImpact(b)) - Math.abs(signedImpact(a)))
      .slice(0, 5)
      .map((item): TopEvent => ({
        title: item.title,
        url: item.url,
        score: item.impactScore,
        signed: Number(signedImpact(item).toFixed(2)),
        dimension: item.dimension,
        direction: item.direction,
        relevance: item.relevance,
      }));

    const dimensions = dayItems.reduce(
      (acc, item) => {
        acc[item.dimension] = (acc[item.dimension] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const capabilityBase = capabilityBaseAt(dayStart);

    return {
      date: dayStart,
      capability: capabilityBase,
      velocity: point.impactIndex ?? 0,
      acceleration: acceleration[i]?.value ?? 0,
      intelligenceIndex: computeIntelligenceIndex(capabilityBase, point.impactIndex),
      eventCount: point.itemCount,
      topEvents: dayEvents as unknown as object,
      dimensions: dimensions as unknown as object,
    };
  });

  // 6. Upsert
  for (const row of rows) {
    await prisma.aiIndexDaily.upsert({
      where: { date: row.date },
      create: row,
      update: row,
    });
  }

  console.log(`Upserted ${rows.length} daily rows`);
  console.log(
    rows.map((r) => ({
      date: isoDay(r.date),
      capability: r.capability,
      impact: r.velocity,
      index: r.intelligenceIndex,
      events: r.eventCount,
    })),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
