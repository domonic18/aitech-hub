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
import * as cheerio from "cheerio";

import { prisma } from "@/lib/db";

import type { SnapshotSink } from "../collect/snapshot-capture";
import { markCuratedSourceStale, persistCuratedRows } from "./curated-persist";
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

export async function fetchKimiMember(
  url: string,
  sink?: SnapshotSink,
): Promise<{ monthly: string; yearly: string }> {
  const shot = { screenshot: sink !== undefined };
  const monthly = await snapshotHtml(url, "连续包月", shot);
  await sink?.({ tab: "monthly", ...monthly });
  const yearly = await snapshotHtml(url, "连续包年", shot);
  await sink?.({ tab: "yearly", ...yearly });
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

/** HTML → 折叠文本(去脚本/样式/标签):快照取回的是整页 DOM,
 * 正则/切片一律在折叠文本上做(2026-10-29 实跑:HTML 直喂正则必失配) */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

export async function fetchGlmCoding(
  url: string,
  sink?: SnapshotSink,
): Promise<{ monthly: string; quarterly: string; yearly: string }> {
  const shot = { screenshot: sink !== undefined };
  const monthly = await snapshotHtml(url, "连续包月", shot);
  await sink?.({ tab: "monthly", ...monthly });
  const quarterly = await snapshotHtml(url, "连续包季", shot);
  await sink?.({ tab: "quarterly", ...quarterly });
  const yearly = await snapshotHtml(url, "连续包年", shot);
  await sink?.({ tab: "yearly", ...yearly });
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
  const folded = htmlToText(read("monthly"));
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

export async function markPlanSourceStale(sourceUrl: string, now: Date): Promise<number> {
  return markCuratedSourceStale(
    sourceUrl,
    now,
    (url) =>
      prisma.codingPlan.findMany({ where: { sourceUrl: url }, select: { id: true, note: true } }),
    (id, note) => prisma.codingPlan.update({ where: { id }, data: { note }, select: { id: true } }),
  );
}

/** 套餐行初稿三规则落库(建 pending/刷 pending/终审行不动) */
export async function persistPlanRows(rows: PlanPrefillRow[]): Promise<{
  created: number;
  refreshed: number;
  untouched: number;
  failed: number;
}> {
  return persistCuratedRows(rows, {
    keyOf: (r) => ({ vendor: r.vendor, key: r.planName }),
    listExisting: async (vendors, keys) => {
      const rows = await prisma.codingPlan.findMany({
        where: { vendor: { in: vendors }, planName: { in: keys } },
        select: { id: true, vendor: true, planName: true, status: true },
      });
      return rows.map((r) => ({ id: r.id, vendor: r.vendor, key: r.planName, status: r.status }));
    },
    create: (r) =>
      prisma.codingPlan.create({
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
      }),
    update: (id, r) =>
      prisma.codingPlan.update({
        where: { id },
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
      }),
  });
}

// ---------- MiniMax M Plan(国内版 www.minimax.cn;年付/月付双态,档名 Go/Explore/Build) ----------

export const MINIMAX_MPLAN_URL = "https://www.minimax.cn/m-plan";

export async function fetchMiniMaxMember(
  url: string,
  sink?: SnapshotSink,
): Promise<{ yearly: string; monthly: string }> {
  const shot = { screenshot: sink !== undefined };
  const yearly = await snapshotHtml(url, "连续包年", shot);
  await sink?.({ tab: "yearly", ...yearly });
  const monthly = await snapshotHtml(url, "连续包月", shot);
  await sink?.({ tab: "monthly", ...monthly });
  return { yearly: yearly.html, monthly: monthly.html };
}

const MINIMAX_TIER_RE = /^(Go|Explore|Build)$/;

export interface MiniMaxCard {
  title: string;
  tagline: string;
  /** 大字现价(促销态=折后价,常态=标准价) */
  price: number;
  /** 划线价(标准价;促销态才有) */
  original: number | null;
  /** 周期原文,如「每年，按年订阅」 */
  cycle: string;
  /** 限时角标,如「限时首月5折」 */
  promo: string | null;
  benefits: string[];
}

function priceOf(text: string): number | null {
  const m = text.match(/[\d,]+(?:\.\d+)?/);
  return m === null ? null : toNumber(m[0]);
}

/** 单态卡片抽取(纯函数,fixture 单测锚):以 `<h3>档名</h3>` 定位卡片根
 * (header 的父节点),卡内按位置取副标题/划线价/现价/周期/权益 `<article>`
 * 列表项。2026-10-29 换国内版后页为真实 DOM,按结构取比折叠文本正则稳
 * (旧版正则靠 `$` 与英文档名锚,中文页金额为「￥588」小写全角且带小数)。 */
export function parseMiniMaxCards(html: string): MiniMaxCard[] {
  const $ = cheerio.load(html);
  const out: MiniMaxCard[] = [];
  $("h3").each((_i, el) => {
    const $title = $(el);
    const title = $title.text().trim();
    if (!MINIMAX_TIER_RE.test(title)) return;
    const card = $title.closest("header").parent();
    if (card.length === 0) return;
    const price = priceOf(card.find("span.tabular-nums").first().text());
    if (price === null) return;
    const original = priceOf(
      card
        .find("span")
        .filter((_j, s) => ($(s).attr("class") ?? "").includes("line-through"))
        .first()
        .text(),
    );
    const promo = card.find("header span").first().text().trim();
    const cycle = card
      .children("div")
      .filter((_j, d) => /每[年月].*按[年月]订阅/.test($(d).text()))
      .first()
      .text()
      .trim();
    const benefits = card
      .find("article p")
      .map((_j, p) => $(p).text().trim())
      .get()
      .filter((b: string) => b !== "");
    out.push({
      title,
      tagline: card.children("p").first().text().trim(),
      price,
      original,
      cycle,
      promo: promo === "" ? null : promo,
      benefits,
    });
  });
  return out;
}

/** 双态合并 → 套餐初稿行(纯函数,fixture 单测锚):
 * 年付态 = 划线价(标准年付,促销价入 billingNote);月付态同理取标准月价,
 * 首月折扣原文并入 note。权益=年付卡片 article 列表项(逐条原文,不拼接)。
 * 币种 CNY(国内版官方页)。 */
export function parseMiniMaxCoding(raw: unknown, sourceUrl: string, now: Date): PlanPrefillRow[] {
  const read = (k: string): string =>
    typeof raw === "object" && raw !== null && k in raw
      ? String((raw as Record<string, unknown>)[k])
      : "";
  const yearlyCards = parseMiniMaxCards(read("yearly"));
  // 首见为准:权益文案可能复现档名词,后到不覆盖
  const monthlyByTitle = new Map<string, MiniMaxCard>();
  for (const c of parseMiniMaxCards(read("monthly"))) {
    if (!monthlyByTitle.has(c.title)) monthlyByTitle.set(c.title, c);
  }

  const rows: PlanPrefillRow[] = [];
  for (const y of yearlyCards) {
    const m = monthlyByTitle.get(y.title) ?? null;
    const yearlyFee = y.original ?? y.price; // 划线价即标准年付
    const monthlyFee = m === null ? null : (m.original ?? m.price);
    const parts: string[] = [
      y.original === null
        ? `年付 ¥${y.price}/年`
        : `年付标准 ¥${y.original}/年(促销 ¥${y.price}/年)`,
    ];
    if (m !== null) {
      parts.push(
        m.original === null
          ? `月付 ¥${m.price}/月`
          : `月付 ¥${m.original}/月(${m.promo ?? "限时折扣"} ¥${m.price})`,
      );
    }
    rows.push({
      vendor: "MiniMax 稀宇科技",
      planName: `MiniMax M Plan · ${y.title}`,
      currency: "CNY",
      monthlyFee,
      quarterlyFee: null, // MiniMax 无季付档
      yearlyFee,
      billingNote: parts.join(";"),
      benefits: y.benefits.length > 0 ? y.benefits : null,
      quotaDesc: "权益口径以官方页为准",
      peakRate: null,
      offPeakRate: null,
      bestFor: y.tagline === "" ? null : y.tagline,
      note: null,
      dataAsOf: now,
      sourceUrl,
    });
  }
  if (rows.length === 0) throw new Error("minimax 卡片结构未匹配(前端可能重构)");
  return rows;
}

// ---------- Xiaomi MiMo Token Plan(连续包年默认态:折合月价+包月原价) ----------

export const XIAOMI_TOKEN_URL = "https://platform.xiaomimimo.com/token-plan";

export async function fetchXiaomiToken(url: string, sink?: SnapshotSink): Promise<string> {
  const page = await snapshotHtml(url, undefined, { screenshot: sink !== undefined });
  await sink?.({ tab: "page", ...page });
  return page.html;
}

const XIAOMI_TIER_RE = /^(Lite|Standard|Pro|Max)$/;

export interface XiaomiCard {
  title: string;
  tagline: string;
  /** 当前 tab 展示价(默认连续包年 88 折,折合每月) */
  shown: number;
  /** 划线价 = 连续包月标准价 */
  standard: number | null;
  /** 年付立减原文,如「立减 960 元」 */
  discount: string | null;
  benefits: string[];
}

/** 单态卡片解析(纯函数,fixture 单测锚):以档名 `<p>`(24px 档名)定位卡片根
 * (最近的 rounded-[16px] 容器),卡内取主价 `span.font-misans` / 划线价
 * `span.line-through` / 权益 `<p>` 列表。2026-10-29 验收问题二修复:旧版按
 * 折叠文本切「下一档名」定段,末档无终点 → 权益吞进整页页脚(邀请返现/工具
 * 矩阵/FAQ/版权)。按结构取卡片根后不再跨卡,页脚彻底出界。 */
export function parseXiaomiCards(html: string): XiaomiCard[] {
  const $ = cheerio.load(html);
  const out: XiaomiCard[] = [];
  $("p").each((_i, el) => {
    const $t = $(el);
    const title = $t.text().trim();
    if (!XIAOMI_TIER_RE.test(title) || $t.children().length > 0) return;
    if (!($t.attr("class") ?? "").includes("text-[24px]")) return;
    const card = $t.closest('div[class*="rounded-[16px]"]');
    if (card.length === 0) return;
    const shown = priceOf(card.find('span[class*="font-misans"]').first().text());
    if (shown === null) return;
    const standard = priceOf(card.find('span[class*="line-through"]').first().text());
    const discount =
      card
        .text()
        .replace(/\s+/g, " ")
        .match(/立减 ?[\d,]+ ?元/)?.[0] ?? null;
    // 权益 = 卡内 14px 明细行:主行(#1a1a1a)开条,次行(black/45)并入上一条
    const benefits: string[] = [];
    card.find('p[class*="text-[14px] leading-4"]').each((_j, p) => {
      const cls = $(p).attr("class") ?? "";
      const text = $(p).text().trim();
      if (text === "") return;
      const last = benefits.length - 1;
      if (cls.includes("text-black/45") && last >= 0) benefits[last] = `${benefits[last]}(${text})`;
      else benefits.push(text);
    });
    out.push({
      title,
      tagline: $t.nextAll("p").first().text().trim(),
      shown,
      standard,
      discount,
      benefits,
    });
  });
  return out;
}

/** 单态 → 套餐初稿行(纯函数,fixture 单测锚):展示价入 yearlyFee(折合月),
 * 划线价入 monthlyFee(连续包月标准),两者比值反推折扣写进注记;
 * Credits 行即额度口径;谷时倍率取自权益原文「夜间 0.8x 消耗」。 */
export function parseXiaomiToken(html: string, sourceUrl: string, now: Date): PlanPrefillRow[] {
  const rows: PlanPrefillRow[] = [];
  // 折扣口径取页签原文「连续包年 88 折」——按价格反推会因展示价取整而漂成 87 折
  const tabRate = htmlToText(html).match(/连续包年 ?([\d.]+ ?折)/)?.[1] ?? null;
  for (const c of parseXiaomiCards(html)) {
    const credits = c.benefits.find((b) => b.includes("Credits")) ?? "权益口径以官方页为准";
    const derived =
      c.standard !== null && c.standard > c.shown
        ? `${Math.round((c.shown / c.standard) * 100)} 折`
        : null;
    const rate = tabRate ?? derived;
    const parts: string[] = [];
    parts.push(
      c.standard === null
        ? `包年折合 ¥${c.shown}/月`
        : `连续包年${rate === null ? "" : ` ${rate}`}折合 ¥${c.shown}/月(连续包月 ¥${c.standard}/月)`,
    );
    if (c.discount !== null) parts.push(`按年计费${c.discount}`);
    rows.push({
      vendor: "小米 MiMo",
      planName: `MiMo Token Plan · ${c.title}`,
      currency: "CNY",
      monthlyFee: c.standard,
      quarterlyFee: null, // 小米无季付档(首购优惠为一次性活动价不收)
      yearlyFee: c.shown,
      billingNote: parts.join(";"),
      benefits: c.benefits.length > 0 ? c.benefits : null,
      quotaDesc: credits,
      peakRate: null,
      offPeakRate: "谷 0.8×", // 官方页原文:夜间 00:00—08:00(UTC+8)消耗 0.8×
      bestFor: c.tagline === "" ? null : c.tagline,
      note: null,
      dataAsOf: now,
      sourceUrl,
    });
  }
  if (rows.length === 0) throw new Error("xiaomi 卡片结构未匹配(前端可能重构)");
  return rows;
}

// ---------- 阿里云百炼帮助中心静态页(Token Plan 订阅产品) ----------
// 2026-10-29 用户拍板:百炼 Coding Plan 渠道撤除,只留 Token Plan(个人版四档)。
// 官方原文虽把两者列为独立订阅产品,但同时收录会让同一厂商在页面上出现两套
// 不可比的额度口径(Coding=次请求/Credits 混排),对「比价」动线是噪音。

export const BAILIAN_TOKEN_URL = "https://help.aliyun.com/zh/model-studio/token-plan-overview";

/** 帮助中心静态页取数(直 fetch 无浏览器,故快照只有 HTML) */
export async function fetchBailianPage(url: string, sink?: SnapshotSink): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  // 失败也留证:错误页/风控页本身就是排查材料(先落快照再抛)
  const html = await res.text();
  await sink?.({ tab: "page", html, httpStatus: res.status });
  if (!res.ok) throw new Error(`bailian http ${res.status}`);
  return html;
}

/** Token Plan 概述页解析(纯函数,fixture 单测锚)。
 * 只收**个人版四档**(Lite/Essential/Standard/Pro):与其余渠道同为「个人订阅
 * 元/月」可比口径;团队版按座席计价、用量包为加购项(元/个/月),口径不同不入库。
 * 页面是「表头一行档名 + 各行取值」的表,故按出现顺序对齐三组序列(档名/定价/
 * 每月限额),任一数量不齐即抛错(改版可见,不静默错配)。
 * 限时价与 MiniMax 同一口径:原价入 monthlyFee,限时价与原文入 billingNote。 */
export function parseBailianToken(html: string, sourceUrl: string, now: Date): PlanPrefillRow[] {
  const text = htmlToText(html);
  // 档名取**连续表头串**(Lite 套餐 Essential 套餐 …):页内正文另有「Standard 与
  // Pro 套餐附赠…」之类散落提及,不做连续串限定会多算出档位、错配价格
  const headerRun = text.match(/(?:(?:Lite|Essential|Standard|Pro) 套餐 ?)+/)?.[0] ?? "";
  const tiers = [...headerRun.matchAll(/(Lite|Essential|Standard|Pro) 套餐/g)].map(
    (m) => m[1] ?? "",
  );
  // 团队版为「原价 198 元/座席/月」,单价单位不同自然不入此列
  const prices = [...text.matchAll(/原价 ?([\d,.]+) ?元\/月(?: ?限时 ?([\d,.]+) ?元\/月)?/g)].map(
    (m) => ({ standard: Number(m[1]?.replace(/,/g, "")), promo: m[2] ?? null }),
  );
  const quotaBlock = text.match(/每月限额 ?((?:[\d,]+ ?Credits ?){1,6})/)?.[1] ?? "";
  // 千分位原样保留(展示字段,不转数值)
  const quotas = [...quotaBlock.matchAll(/([\d,]+) ?Credits/g)].map((m) => m[1] ?? "");
  const concBlock = text.match(/并发 Agent ?((?:[\d-]+ ?个 ?)+)/)?.[1] ?? "";
  const concurrency = [...concBlock.matchAll(/([\d-]+) ?个/g)].map((m) => m[1] ?? "");

  if (tiers.length === 0 || prices.length !== tiers.length || quotas.length !== tiers.length) {
    throw new Error(
      `bailian token 结构未匹配(档名 ${tiers.length}/定价 ${prices.length}/限额 ${quotas.length})`,
    );
  }

  const shared = "文本/图像/视频/语音模型与模型内置工具统一按 Credits 抵扣";
  return tiers.map((tier, i) => {
    const p = prices[i]!;
    const quota = quotas[i]!;
    const conc = concurrency[i] ?? null;
    const benefits = [`每月限额 ${quota} Credits`];
    if (conc !== null) benefits.push(`并发 Agent ${conc} 个`);
    benefits.push(shared);
    // 官方原文:Standard 与 Pro 套餐附赠 AgentStudio 工具免费额度与折扣,不占 Credits
    if (tier === "Standard" || tier === "Pro") benefits.push("附赠 AgentStudio 工具额度与折扣");
    return {
      vendor: "阿里云百炼",
      planName: `百炼 Token Plan · ${tier}`,
      currency: "CNY" as const,
      monthlyFee: p.standard,
      quarterlyFee: null,
      yearlyFee: null, // 官方页仅月付/用量包口径
      billingNote: p.promo === null ? null : `限时优惠 ¥${p.promo}/月(原价 ¥${p.standard}/月)`,
      benefits,
      quotaDesc: `${quota} Credits/月`,
      peakRate: null,
      offPeakRate: null,
      bestFor: null,
      note: "仅支持华北2(北京)地域",
      dataAsOf: now,
      sourceUrl,
    };
  });
}
