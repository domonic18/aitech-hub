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

import { groupOf } from "./canon";
import { contextTokensFromTiers, formatContextTokens } from "./context";
import type { PublicModelRow, PublicPlanRow, PublicPricing, PublicTierRow } from "./public";
import { tierParamsWithFallback } from "./params";
import { resolveApiProtocols } from "./protocols";
import { resolutionOf } from "./resolution";
import { readTiers } from "./tiers";
import { normalizedUnit, tokenUnitFactor } from "./units";

/** 行级 dataAsOf 展示口径按北京日界取 YYYY-MM-DD(与 formatCnDate 对齐) */
function cnAsOfDay(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

/** 字典 group_key 为 null 时的读侧 canon 兜底(空串 → null 不落字段) */
function computeGroupKey(r: {
  modelKey: string;
  model: { modelKey: string; modality: string } | null;
}): string | null {
  const dict = r.model;
  if (dict === null) return null;
  const group = groupOf(dict.modelKey, dict.modality).groupKey;
  return group === "" ? null : group;
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
          include: { provider: true, model: true },
        }),
        prisma.codingPlan.findMany({
          where: { status: "enabled" },
          orderBy: [{ sortOrder: "asc" }, { vendor: "asc" }],
        }),
      ]);

      // 档位一次性取回(避免 N+1);无档位的行给空数组
      const tierMap = await readTiers(models.map((m) => m.id));

      const modelRows: PublicModelRow[] = models.map((r) => {
        // 计价单位归一:token 系一律「元/百万 tokens」(存量 per_1k 行按 ×1000 换算,
        // 回填前的过渡——列头/比价区/JSON-LD 都只写每百万 tokens,口径不能两套)
        const factor = tokenUnitFactor(r.priceUnit);
        const unit = normalizedUnit(r.priceUnit);
        const tiers: PublicTierRow[] = (tierMap.get(r.id.toString()) ?? []).map((t) => {
          // 档位按**自己的**单位换算(档位与行同源,但不假定必然一致)
          const tierFactor = tokenUnitFactor(t.unit);
          return {
            tierLabel: t.tierLabel,
            inputPrice: t.inputPrice === null ? null : t.inputPrice * tierFactor,
            outputPrice: t.outputPrice === null ? null : t.outputPrice * tierFactor,
            cachePrice: t.cachePrice === null ? null : t.cachePrice * tierFactor,
            minTokens: t.minTokens,
            maxTokens: t.maxTokens,
            unit: normalizedUnit(t.unit),
            currency: t.currency,
            params: tierParamsWithFallback(t.params, t.tierLabel, resolutionOf(t.tierLabel)),
          };
        });
        // 上下文长度:源没给时按档位的输入长度阶梯推导(阶梯上界=上下文封顶)
        const derivedContext = formatContextTokens(contextTokensFromTiers(tiers));
        return {
          vendor: r.vendor,
          modelKey: r.modelKey,
          currency: r.currency,
          inputPrice: r.inputPrice === null ? null : Number(r.inputPrice) * factor,
          outputPrice: r.outputPrice === null ? null : Number(r.outputPrice) * factor,
          freeTier: r.freeTier,
          isFree: r.isFree,
          contextWindow: r.contextWindow ?? derivedContext,
          note: r.note,
          dataAsOf: cnAsOfDay(r.dataAsOf),
          sourceUrl: r.sourceUrl,
          region: r.region,
          providerKey: r.provider?.key ?? null,
          // 聚合源(M74 批B4)行显示用 vendor(如「词元所·博川科技」)而非平台字典名
          // —— 同模型 21 家供应方若同名(百度词元所)比价无法区分;官方源两者一致
          providerName:
            r.provider?.sourceKind === "aggregator" ? r.vendor : (r.provider?.name ?? r.vendor),
          providerKind: r.provider?.sourceKind ?? null,
          modelDictKey: r.model?.modelKey ?? null,
          // 能力归一键(P1):字典值优先(采集复用锚 + 人工覆盖位);字典未算(null)
          // 时按同一 canon 纯函数现算兜底——归一立即生效,不等下轮采集重指 model_id。
          // 人工分离两行 = 给其中一行显式独立的组键,而非留 null
          modelGroupKey: r.model?.groupKey ?? computeGroupKey(r),
          modelDisplayName: r.model?.displayName ?? null,
          modelFamily: r.model?.family ?? null,
          modality: r.model?.modality ?? null,
          priceUnit: unit,
          protocols: resolveApiProtocols(r.provider?.key ?? null, r.modelKey),
          tiers,
        };
      });
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
