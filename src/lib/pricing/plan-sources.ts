/**
 * 牌价爬虫·套餐面(M56;批B 分层):纯解析/取数/落库库——Kimi 会员定价页
 * (membership/pricing,免登录五档,权益列表含实验性功能)与 GLM /glm-coding
 * 三周期态。渠道编排(DB 驱动、失败合并上抛)在 source-registry.ts。
 * 周期价格按 tab 逐态快照(clickText 点击切换,月/季/年各拍一次由解析器合并);
 * Kimi 年付=周期总价(¥468/年),GLM 季/年=折合每月——口径不归一随原文(D3)。
 * 初稿三规则:建 pending/刷 pending/enabled·disabled 终审行不动;失败源旧数据
 * 按 sourceUrl 标待复核(note 列),整 job 上抛连败可见,不静默腐烂。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

import { withRecheckMark } from "./crawlers";
import { snapshotHtml } from "./render-fetch";

export interface PlanPrefillRow {
  vendor: string;
  planName: string;
  currency: "CNY" | "USD";
  /** 连续包月标准价 */
  monthlyFee: number | null;
  /** 连续包季展示价(折合每月,口径见 billingNote;无季付=null) */
  quarterlyFee: number | null;
  /** 连续包年展示价(Kimi 为周期总价,口径见 billingNote) */
  yearlyFee: number | null;
  /** 周期价格口径原文说明 */
  billingNote: string | null;
  /** 套餐权益详情原文列表(官方页序) */
  benefits: string[] | null;
  quotaDesc: string;
  peakRate: string | null;
  offPeakRate: string | null;
  bestFor: string | null;
  /** 溯源注记(如折后价说明)/待复核标记共用列(模型表 note 同纪律) */
  note: string | null;
  dataAsOf: Date;
  sourceUrl: string;
}

/** 默认官方页(种子初始值;运行期 URL 归 pricing_source 表后台可调) */
export const KIMI_MEMBER_URL = "https://www.kimi.com/membership/pricing?from=kfc_membership_topbar";
export const GLM_CODING_URL = "https://bigmodel.cn/glm-coding";

// ---------- Kimi 会员定价页(月付/年付双态) ----------

async function fetchKimiMember(url: string): Promise<{ monthly: string; yearly: string }> {
  const monthly = await snapshotHtml(url, "连续包月");
  const yearly = await snapshotHtml(url, "连续包年");
  return { monthly: monthly.html, yearly: yearly.html };
}

type KimiCard = {
  title: string;
  tagline: string | null;
  amount: number | null;
  strikethrough: number | null;
  billingCycle: string | null;
  benefits: string[];
};

function toNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 单态卡片解析(纯函数):plan-container 系类名锚(2026-10-29 实测 DOM;
 * 权益=plan-feature 列表项(核心+实验性功能按页序合并),段落式旧形回退) */
export function parseKimiCards(html: string): KimiCard[] {
  const cards = html.split('class="plan-container').slice(1);
  const out: KimiCard[] = [];
  for (const card of cards) {
    const title = card.match(/class="plan-title"\s*>([^<]{1,40})</)?.[1]?.trim();
    if (title === undefined) continue;
    const tagline =
      card.match(/class="plan-tagline"[^>]*>\s*<span[^>]*>\s*([^<]{1,40})</)?.[1]?.trim() ?? null;
    const amount = toNumber(card.match(/class="price-amount"[^>]*>\s*([0-9.,]+)/)?.[1]);
    const strikethrough = toNumber(
      card.match(/class="price-strikethrough"[^>]*>\s*¥\s*([0-9.,]+)/)?.[1],
    );
    const billingCycle =
      card.match(/class="plan-billing-cycle"[^>]*>\s*([^<]{1,60})</)?.[1]?.trim() ?? null;
    const benefits = [
      ...card.matchAll(
        /class="plan-feature"[^>]*>[\s\S]{0,700}?class="paragraph"[^>]*>([^<]{1,120})</g,
      ),
    ]
      .map((m) => (m[1] ?? "").trim())
      .filter(Boolean);
    const paragraphFeatures =
      card.match(/class="plan-features"[^>]*>\s*([^<]{2,400})</)?.[1]?.trim() ?? null;
    out.push({
      title,
      tagline,
      amount,
      strikethrough,
      billingCycle,
      benefits:
        benefits.length > 0 ? benefits : paragraphFeatures !== null ? [paragraphFeatures] : [],
    });
  }
  return out;
}

/** 双态合并 → 套餐初稿行(纯函数,fixture 单测锚):
 * 月付价=包月态 amount;年付价=年付态 billing-cycle 周期总价(原文「按年计费
 * ¥468」→ 468);权益整列入库(含实验性功能,页序);额度口径=权益首条。 */
export function parseKimiCoding(raw: unknown, sourceUrl: string, now: Date): PlanPrefillRow[] {
  const read = (key: string): string =>
    typeof raw === "object" && raw !== null && key in raw
      ? String((raw as Record<string, unknown>)[key])
      : "";
  const monthlyCards = parseKimiCards(read("monthly"));
  const yearlyByTitle = new Map(parseKimiCards(read("yearly")).map((c) => [c.title, c] as const));

  const rows: PlanPrefillRow[] = [];
  for (const m of monthlyCards) {
    if (m.amount === null) continue; // 无价不臆测
    const y = yearlyByTitle.get(m.title);
    const yearlyTotal =
      y?.billingCycle !== null && y?.billingCycle !== undefined
        ? toNumber(y.billingCycle.match(/¥\s*([0-9,.]+)/)?.[1])
        : null;
    rows.push({
      vendor: "月之暗面 Kimi",
      planName: `Kimi 会员 · ${m.title}`,
      currency: "CNY",
      monthlyFee: m.amount,
      quarterlyFee: null, // Kimi 无季付档
      yearlyFee: yearlyTotal,
      billingNote:
        yearlyTotal !== null
          ? `年付为周期总价(官方原文「${y?.billingCycle ?? ""}」);月付展示价可能含促销`
          : null,
      benefits: m.benefits.length > 0 ? m.benefits : null,
      quotaDesc: (m.benefits[0] ?? "权益口径以官方页为准").slice(0, 200),
      peakRate: null,
      offPeakRate: null,
      bestFor: m.tagline,
      note: null,
      dataAsOf: now,
      sourceUrl,
    });
  }
  if (rows.length === 0) throw new Error("kimi 会员卡结构未匹配(前端可能重构)");
  return rows;
}

// ---------- GLM /glm-coding(月/季/年三态) ----------

async function fetchGlmCoding(
  url: string,
): Promise<{ monthly: string; quarterly: string; yearly: string }> {
  const monthly = await snapshotHtml(url, "连续包月");
  const quarterly = await snapshotHtml(url, "连续包季");
  const yearly = await snapshotHtml(url, "连续包年");
  return { monthly: monthly.html, quarterly: quarterly.html, yearly: yearly.html };
}

/** 单态卡片解析(纯函数):cp-card 系类名锚(2026-10-29 实测 DOM) */
export function parseGlmCards(html: string) {
  const cards = html.split('class="cp-card ').slice(1);
  const out: Array<{
    title: string;
    description: string | null;
    shown: number | null;
    original: number | null;
    features: string[];
  }> = [];
  for (const card of cards) {
    const title = card.match(/cp-card__title[^>]*>\s*(?:<[^>]+>\s*)*([A-Za-z]+)/)?.[1];
    if (title === undefined) continue;
    const description =
      card.match(/cp-card__description[^>]*>\s*([^<]{2,20})</)?.[1]?.trim() ?? null;
    const shown = toNumber(card.match(/cp-card__price-amount[^>]*>([0-9.,]+)/)?.[1]);
    const original = toNumber(
      card.match(/cp-card__price-original[\s\S]{0,300}?¥<\/span><span[^>]*>([0-9.,]+)</)?.[1],
    );
    const features = [...card.matchAll(/cp-card__feature-text[^>]*>\s*([^<]{2,80})</g)]
      .map((m) => (m[1] ?? "").trim())
      .filter(Boolean);
    out.push({ title, description, shown, original, features });
  }
  return out;
}

/** 三态合并 → 套餐初稿行(纯函数,fixture 单测锚):
 * 月付=包月态 shown;季/年=对应 tab 折合月价;权益=全部 feature 文本(官方页序);
 * 额度口径=首条 feature;折扣文案从周期签原文解析(连续包季9折/包年8折)。 */
export function parseGlmCoding(raw: unknown, sourceUrl: string, now: Date): PlanPrefillRow[] {
  const read = (key: string): string =>
    typeof raw === "object" && raw !== null && key in raw
      ? String((raw as Record<string, unknown>)[key])
      : "";
  const monthlyCards = parseGlmCards(read("monthly"));
  const quarterly = new Map(parseGlmCards(read("quarterly")).map((c) => [c.title, c] as const));
  const yearly = new Map(parseGlmCards(read("yearly")).map((c) => [c.title, c] as const));
  const folded = read("monthly")
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const qDiscount = folded.match(/连续包季\s*([0-9.]+折)/)?.[1] ?? null;
  const yDiscount = folded.match(/连续包年\s*([0-9.]+折)/)?.[1] ?? null;

  const rows: PlanPrefillRow[] = [];
  for (const card of monthlyCards) {
    const q = quarterly.get(card.title);
    const y = yearly.get(card.title);
    if (card.shown === null) continue; // 无价不臆测
    const highlight = card.features[0] ?? null;
    const billingParts: string[] = [];
    if (q?.shown !== null && q?.shown !== undefined && qDiscount !== null)
      billingParts.push(`连续包季${qDiscount}折合 ¥${q.shown}/月`);
    if (y?.shown !== null && y?.shown !== undefined && yDiscount !== null)
      billingParts.push(`连续包年${yDiscount}折合 ¥${y.shown}/月`);
    rows.push({
      vendor: "智谱 AI · BigModel",
      planName: `GLM Coding Plan · ${card.title}`,
      currency: "CNY",
      monthlyFee: card.shown,
      quarterlyFee: q?.shown ?? null,
      yearlyFee: y?.shown ?? null,
      billingNote: billingParts.length > 0 ? billingParts.join(";") : null,
      benefits: card.features.length > 0 ? card.features : null,
      quotaDesc: (highlight ?? "权益口径以官方页为准").slice(0, 200),
      peakRate: null,
      // 官方文档原文(coding-plan/overview):非高峰时段按基础积分 50% 抵扣
      offPeakRate: "谷 0.5×",
      bestFor: card.description,
      note: null,
      dataAsOf: now,
      sourceUrl,
    });
  }
  if (rows.length === 0) throw new Error("glm-coding 卡片结构未匹配(前端可能重构)");
  return rows;
}

/** 单套餐源取数+解析(rendered 型双/三态快照;编排层按渠道逐个调,失败自吞) */
export async function crawlPlanSource(
  key: string,
  kind: string,
  url: string,
  now: Date,
): Promise<{ ok: boolean; rows: PlanPrefillRow[]; error?: string }> {
  try {
    if (kind !== "rendered") throw new Error(`套餐源不支持 kind=${kind}(仅 rendered)`);
    const raw =
      key === "kimi-membership"
        ? await fetchKimiMember(url)
        : key === "glm-coding"
          ? await fetchGlmCoding(url)
          : null;
    if (raw === null) throw new Error(`套餐渠道 key=${key} 无取数器`);
    const rows =
      key === "kimi-membership" ? parseKimiCoding(raw, url, now) : parseGlmCoding(raw, url, now);
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export async function markPlanSourceStale(sourceUrl: string, now: Date): Promise<number> {
  const stale = await prisma.codingPlan.findMany({
    where: { sourceUrl },
    select: { id: true, note: true },
  });
  for (const row of stale) {
    await prisma.codingPlan.update({
      where: { id: row.id },
      data: { note: withRecheckMark(row.note, now) },
      select: { id: true },
    });
  }
  return stale.length;
}

/** 套餐行初稿三规则落库(建 pending/刷 pending/终审行不动) */
export async function persistPlanRows(rows: PlanPrefillRow[]): Promise<{
  created: number;
  refreshed: number;
  untouched: number;
  failed: number;
}> {
  const tally = { created: 0, refreshed: 0, untouched: 0, failed: 0 };
  const existing = await prisma.codingPlan.findMany({
    where: {
      vendor: { in: [...new Set(rows.map((r) => r.vendor))] },
      planName: { in: rows.map((r) => r.planName) },
    },
    select: { id: true, vendor: true, planName: true, status: true },
  });
  const byKey = new Map(existing.map((e) => [`${e.vendor}|${e.planName}`, e]));

  for (const r of rows) {
    const hit = byKey.get(`${r.vendor}|${r.planName}`);
    try {
      if (hit === undefined) {
        await prisma.codingPlan.create({
          data: {
            vendor: r.vendor,
            planName: r.planName,
            currency: r.currency,
            monthlyFee: r.monthlyFee,
            quarterlyFee: r.quarterlyFee,
            yearlyFee: r.yearlyFee,
            billingNote: r.billingNote,
            benefits: r.benefits === null ? Prisma.DbNull : r.benefits,
            quotaDesc: r.quotaDesc,
            peakRate: r.peakRate,
            offPeakRate: r.offPeakRate,
            bestFor: r.bestFor,
            note: r.note,
            dataAsOf: r.dataAsOf,
            sourceUrl: r.sourceUrl,
            status: "pending",
          },
          select: { id: true },
        });
        tally.created += 1;
      } else if (hit.status === "pending") {
        await prisma.codingPlan.update({
          where: { id: hit.id },
          data: {
            currency: r.currency,
            monthlyFee: r.monthlyFee,
            quarterlyFee: r.quarterlyFee,
            yearlyFee: r.yearlyFee,
            billingNote: r.billingNote,
            benefits: r.benefits === null ? Prisma.DbNull : r.benefits,
            quotaDesc: r.quotaDesc,
            peakRate: r.peakRate,
            offPeakRate: r.offPeakRate,
            bestFor: r.bestFor,
            note: r.note,
            dataAsOf: r.dataAsOf,
            sourceUrl: r.sourceUrl,
          },
          select: { id: true },
        });
        tally.refreshed += 1;
      } else {
        tally.untouched += 1;
      }
    } catch {
      tally.failed += 1;
    }
  }
  return tally;
}
