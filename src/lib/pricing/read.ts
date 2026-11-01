/**
 * /pricing/ 公开读侧(M55 批D;2026-11-01 从 public.ts 拆出):仅 enabled 行
 * (停用/待审不可见),ISR SSR 全量进 HTML(SEO 生命线);数据按源整批核对,
 * 不做行级混合龄——45 天过期提醒按表取 max(dataAsOf) 判。
 *
 * ⚠️ 拆出的原因:客户端组件(PricingExplorer 一族)要用 public.ts 里的纯函数,
 * 而本模块链到 `@/lib/db` → `@/lib/env`。两者同居时 env 校验会被打进 /pricing/
 * 的 client chunk,浏览器里 `DATABASE_URL` 缺失直接抛错、页面白屏
 * (2026-11-01 生产事故,同站点设置页一并暴露)。public.ts 因此必须保持零库依赖。
 */
import { prisma } from "@/lib/db";
import { prerenderSafe } from "@/lib/prerender-safe";

import type { PublicModelRow, PublicPlanRow, PublicPricing } from "./public";

/** 行级 dataAsOf 展示口径按北京日界取 YYYY-MM-DD(与 formatCnDate 对齐) */
function cnAsOfDay(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

export async function listPublicPricing(): Promise<PublicPricing> {
  // 构建期无库降级(prerenderSafe 纪律,docker/CI 构建暴露过):ISR 页产物
  // 空数据,首次访问实查缓存;运行时错误照常上抛不静默
  return prerenderSafe(
    "pricing.public",
    { models: [], plans: [], modelsAsOf: null, plansAsOf: null },
    async () => {
      const [models, plans] = await Promise.all([
        prisma.modelPricing.findMany({
          where: { status: "enabled" },
          orderBy: [{ region: "asc" }, { sortOrder: "asc" }, { vendor: "asc" }],
        }),
        prisma.codingPlan.findMany({
          where: { status: "enabled" },
          orderBy: [{ sortOrder: "asc" }, { vendor: "asc" }],
        }),
      ]);

      const modelRows: PublicModelRow[] = models.map((r) => ({
        vendor: r.vendor,
        modelKey: r.modelKey,
        currency: r.currency,
        inputPrice: r.inputPrice === null ? null : Number(r.inputPrice),
        outputPrice: r.outputPrice === null ? null : Number(r.outputPrice),
        freeTier: r.freeTier,
        contextWindow: r.contextWindow,
        note: r.note,
        dataAsOf: cnAsOfDay(r.dataAsOf),
        sourceUrl: r.sourceUrl,
        region: r.region,
      }));
      const planRows: PublicPlanRow[] = plans.map((r) => ({
        vendor: r.vendor,
        planName: r.planName,
        currency: r.currency,
        monthlyFee: r.monthlyFee === null ? null : Number(r.monthlyFee),
        quarterlyFee: r.quarterlyFee === null ? null : Number(r.quarterlyFee),
        yearlyFee: r.yearlyFee === null ? null : Number(r.yearlyFee),
        billingNote: r.billingNote,
        benefits: Array.isArray(r.benefits) ? (r.benefits as string[]) : null,
        quotaDesc: r.quotaDesc,
        peakRate: r.peakRate,
        offPeakRate: r.offPeakRate,
        bestFor: r.bestFor,
        note: r.note,
        dataAsOf: cnAsOfDay(r.dataAsOf),
        sourceUrl: r.sourceUrl,
      }));

      const maxAsOf = (rows: Array<{ dataAsOf: string }>): string | null =>
        rows.length === 0 ? null : rows.map((r) => r.dataAsOf).reduce((a, b) => (a > b ? a : b));

      return {
        models: modelRows,
        plans: planRows,
        modelsAsOf: maxAsOf(modelRows),
        plansAsOf: maxAsOf(planRows),
      };
    },
  );
}
