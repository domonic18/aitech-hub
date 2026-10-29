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

import { markCuratedSourceStale, persistCuratedRows } from "./curated-persist";
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

export async function fetchKimiMember(url: string): Promise<{ monthly: string; yearly: string }> {
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

// ---------- MiniMax M Plan(年付/月付双态;页为 EN,档名 Go/Explore/Build) ----------

export const MINIMAX_MPLAN_URL = "https://www.minimax.io/m-plan";

export async function fetchMiniMaxMember(
  url: string,
): Promise<{ yearly: string; monthly: string }> {
  const yearly = await snapshotHtml(url, "Yearly");
  const monthly = await snapshotHtml(url, "Monthly");
  return { yearly: yearly.html, monthly: monthly.html };
}

/** MiniMax 单态折叠文本 → 档位(纯函数):档名 + 首个 $ 金额 + 可选第二个 $ 金额
 * + 匹配下标(权益切片按档位原位定位,勿用金额字符串反查——真实文本 `$264`
 * 无空格,`$ 264` 查不到会把多档切片全落到第一档) */
export function miniMaxTiers(
  text: string,
): Array<{ title: string; tagline: string; first: number; second: number | null; index: number }> {
  const out: Array<{
    title: string;
    tagline: string;
    first: number;
    second: number | null;
    index: number;
  }> = [];
  const re = /\b(Go|Explore|Build) ([^$]{2,40}?)\$ ?([\d,]+)(?: \$ ?([\d,]+))?/g;
  for (const m of text.matchAll(re)) {
    out.push({
      title: m[1] ?? "",
      tagline: (m[2] ?? "").trim().slice(-30),
      first: Number((m[3] ?? "").replace(/,/g, "")),
      second: m[4] === undefined ? null : Number(m[4].replace(/,/g, "")),
      index: m.index ?? 0,
    });
  }
  return out;
}

/** 双态合并 → 套餐初稿行(纯函数,fixture 单测锚):
 * 年付态两笔 $ = 标准年付(大)/促销年付(小,立减 2 个月);月付态单 $ = 月付价;
 * 权益=年付文本本档 Purchase 之后至下一档的原文段(整段直出不失真)。
 * 限注:档名随官方页语言(Go/Explore/Build),权益原文随渲染语言。 */
export function parseMiniMaxCoding(raw: unknown, sourceUrl: string, now: Date): PlanPrefillRow[] {
  const read = (k: string): string =>
    typeof raw === "object" && raw !== null && k in raw
      ? String((raw as Record<string, unknown>)[k])
      : "";
  const yearlyText = htmlToText(read("yearly"));
  const yearlyTiers = miniMaxTiers(yearlyText);
  // 首见为准:权益文案可能复现档名词(如「3x Go usage」),后到不覆盖
  const monthlyByTitle = new Map<string, number>();
  for (const t of miniMaxTiers(htmlToText(read("monthly")))) {
    if (!monthlyByTitle.has(t.title)) monthlyByTitle.set(t.title, t.first);
  }

  const rows: PlanPrefillRow[] = [];
  for (let i = 0; i < yearlyTiers.length; i += 1) {
    const t = yearlyTiers[i]!;
    const next = yearlyTiers[i + 1];
    if (!Number.isFinite(t.first) || t.first <= 0) continue;
    const monthly = monthlyByTitle.get(t.title) ?? null;
    // 权益=本档价位块「Purchase」之后至下一档起点(原位切片,档间不串味)
    const segStart = yearlyText.indexOf("Purchase", t.index);
    const segEnd = next?.index ?? yearlyText.length;
    const benefitsBlob =
      segStart > -1 && segEnd > segStart
        ? yearlyText.slice(segStart + "Purchase".length, segEnd).trim()
        : "";
    rows.push({
      vendor: "MiniMax 稀宇科技",
      planName: `MiniMax M Plan · ${t.title}`,
      currency: "USD",
      monthlyFee: monthly,
      quarterlyFee: null, // MiniMax 无季付档
      yearlyFee: t.first, // 标准年付(大位);促销位入 billingNote
      billingNote:
        t.second !== null
          ? `年付标准 $${t.first}/年(促销 $${t.second}/年,立减 2 个月);月付 $${monthly ?? "?"}/月`
          : null,
      benefits: benefitsBlob !== "" ? [benefitsBlob] : null,
      quotaDesc: "权益口径以官方页为准",
      peakRate: null,
      offPeakRate: null,
      bestFor: t.tagline,
      note: "档名随官方页语言;权益原文随渲染语言",
      dataAsOf: now,
      sourceUrl,
    });
  }
  if (rows.length === 0) throw new Error("minimax 卡片结构未匹配(前端可能重构)");
  return rows;
}

// ---------- Xiaomi MiMo Token Plan(连续包年默认态:折合月价+包月原价) ----------

export const XIAOMI_TOKEN_URL = "https://platform.xiaomimimo.com/token-plan";

export async function fetchXiaomiToken(url: string): Promise<string> {
  return (await snapshotHtml(url)).html;
}

/** 小米单态卡片解析(纯函数,fixture 单测锚):折叠文本
 * `Lite 轻量体验 ¥ 34 / 月 ¥39 按年计费 …9840 亿 Credits…`——
 * 首价=当前 tab(默认连续包年 88 折折合月),次价=连续包月标准价;Credits=额度口径。 */
export function parseXiaomiToken(html: string, sourceUrl: string, now: Date): PlanPrefillRow[] {
  const text = htmlToText(html);
  const rows: PlanPrefillRow[] = [];
  const re =
    /\b(Lite|Standard|Pro|Max) ([^¥]{2,12}?)¥ ?([\d.]+) ?\/ ?月\s*¥ ?([\d,.]+)([\s\S]*?)(?=\b(?:Lite|Standard|Pro|Max) [^¥]{2,12}¥|$)/g;
  for (const m of text.matchAll(re)) {
    const title = m[1] ?? "";
    const bestFor = (m[2] ?? "").trim();
    const shown = Number((m[3] ?? "").replace(/,/g, ""));
    const standard = Number((m[4] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(standard) || standard <= 0) continue;
    const seg = m[5] ?? "";
    const credits = seg.match(/([\d,.]+ ?(?:亿|万)? ?Credits)/)?.[1]?.trim() ?? null;
    rows.push({
      vendor: "小米 MiMo",
      planName: `MiMo Token Plan · ${title}`,
      currency: "CNY",
      monthlyFee: standard,
      quarterlyFee: null, // 小米无季付档(首购优惠为一次性活动价不收)
      yearlyFee: shown,
      billingNote: `连续包年 88 折折合 ¥${shown}/月(连续包月 ¥${standard}/月)`,
      benefits: seg.trim() !== "" ? [seg.trim()] : null,
      quotaDesc: credits ?? "权益口径以官方页为准",
      peakRate: null,
      offPeakRate: "谷 0.8×", // 官方页原文:夜间 00:00—08:00(UTC+8)消耗 0.8×
      bestFor,
      note: null,
      dataAsOf: now,
      sourceUrl,
    });
  }
  if (rows.length === 0) throw new Error("xiaomi 卡片结构未匹配(前端可能重构)");
  return rows;
}

// ---------- 阿里云百炼 Coding Plan(帮助中心静态页,单档 Pro) ----------

export const BAILIAN_CODING_URL = "https://help.aliyun.com/zh/model-studio/coding-plan";

export async function fetchBailianCoding(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`bailian http ${res.status}`);
  return res.text();
}

/** 帮助页静态文本解析(纯函数,fixture 单测锚):单档 Pro
 * 价格 ¥200/月(新客首月 ¥39.90);用量=5h/周/月三行;推荐模型=权益。 */
export function parseBailianCoding(html: string, sourceUrl: string, now: Date): PlanPrefillRow[] {
  const text = htmlToText(html);
  const price = text.match(/价格 ¥ ?([\d,.]+) ?\/月/) ?? text.match(/价格 ¥ ?([\d,.]+)/);
  if (price === null) throw new Error("bailian 价格结构未匹配(页面可能改版)");
  const monthlyFee = Number(price[1]);
  const firstMonth = text.match(/首月 ¥ ?([\d,.]+)/)?.[1] ?? null;
  const quota =
    text.match(
      /每 5 小时 ?[\d,]+ ?次请求[\s\S]*?每周 ?[\d,]+ ?次请求[\s\S]*?每月 ?[\d,]+ ?次请求/,
    )?.[0] ?? "";
  const models = text.match(/推荐模型:([\s\S]{5,160}?)(?:更多模型|额度消耗|$)/)?.[1] ?? "";
  const benefits = models
    .split(/[、,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
    .slice(0, 6);
  return [
    {
      vendor: "阿里云百炼",
      planName: "百炼 Coding Plan · Pro",
      currency: "CNY",
      monthlyFee,
      quarterlyFee: null,
      yearlyFee: null, // 官方页仅月付口径
      billingNote:
        firstMonth !== null
          ? `新客首月 ¥${firstMonth}(官网目录价 ¥${monthlyFee}/月),后续按 ¥${monthlyFee}/月 续费`
          : null,
      benefits: benefits.length > 0 ? benefits : null,
      quotaDesc: (quota !== "" ? quota : "权益口径以官方页为准").replace(/\s+/g, "").slice(0, 200),
      peakRate: null,
      offPeakRate: null,
      bestFor: null,
      note: null,
      dataAsOf: now,
      sourceUrl,
    },
  ];
}
