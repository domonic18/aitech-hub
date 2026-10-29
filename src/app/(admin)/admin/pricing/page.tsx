/**
 * 价格速查策展台(M55 批A):/pricing/ 公开页的数据治理面——上半区模型牌价、
 * 下半区 Coding Plan 套餐。官方爬虫+人工两通道数据统一落 pending,本页人工
 * 终审 enabled。服务端直查不设读 API 渲染依赖。
 * 渠道管理块(M56 批B):渠道 URL/启停后台可调零发版(加载时幂等种子兜底)。
 * (批B OpenRouter 预填通道已砍除——非刚需,2026-10-29 用户拍板)
 */
import ModelsBoard from "@/components/admin/pricing/ModelsBoard";
import PlansBoard from "@/components/admin/pricing/PlansBoard";
import SourcesBoard from "@/components/admin/pricing/SourcesBoard";
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
          <h2 className="text-base font-semibold">价格速查</h2>
          <p className="mt-0.5 text-xs text-text-3">
            /pricing/ 公开页的数据源:官方一手牌价人工策展 · 爬虫/手工落「待审」,点状态钮终审发布 ·
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
      <ModelsBoard rows={models} />
      <PlansBoard rows={plans} />
      <SourcesBoard
        rows={sources.map((s) => ({
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
