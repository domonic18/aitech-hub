/**
 * 牌价管理(M55 批A 建;M56 验收 IA 归位 2026-10-29:自「数据」组迁「内容」组
 * 并更名——公开页叫价格速查,后台叫牌价管理,各归其位):/pricing/ 公开页的
 * 数据治理面。页签化(模型牌价 | Coding Plan | 渠道管理,PricingConsole);
 * 服务端直查不设读 API 渲染依赖。渠道管理块:URL/启停后台可调零发版。
 * (批B OpenRouter 预填通道已砍除——非刚需,2026-10-29 用户拍板)
 */
import PricingConsole from "@/components/admin/pricing/PricingConsole";
import TriggerButtons from "@/components/admin/discovery/TriggerButtons";
import { requireAdminPage } from "@/lib/auth/guard";
import { listCodingPlans, listModelPricing } from "@/lib/pricing/admin";
import { prisma } from "@/lib/db";
import { syncPricingSources } from "@/lib/pricing/source-registry";

export const dynamic = "force-dynamic";

export default async function AdminPricingPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  // 渠道种子兜底(worker 引导同款幂等补缺;此处兜 manual 直接进策展台路径)
  await syncPricingSources().catch(() => undefined);
  const [models, plans, sources] = await Promise.all([
    listModelPricing(),
    listCodingPlans(),
    prisma.pricingSource.findMany({ orderBy: [{ sortOrder: "asc" }] }),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">牌价管理</h2>
          <p className="mt-0.5 text-xs text-text-3">
            /pricing/ 公开页「价格速查」的数据源:官方爬虫/手工落「待审」,终审发布 ·
            额度口径按官方原文呈现
          </p>
        </div>
        <TriggerButtons
          endpoint="/api/pricing/sync"
          jobs={[
            {
              job: "crawl-official",
              label: "爬取官方页初稿",
              hint: "按渠道管理块当前启用的渠道爬取落待审;源失败时该源旧数据标「待复核」且连败进健康页",
            },
          ]}
        />
      </div>
      <PricingConsole
        models={models}
        plans={plans}
        sources={sources.map((s) => ({
          key: s.key,
          target: s.target,
          kind: s.kind,
          label: s.label,
          vendor: s.vendor,
          url: s.url,
          enabled: s.enabled,
        }))}
      />
    </div>
  );
}
