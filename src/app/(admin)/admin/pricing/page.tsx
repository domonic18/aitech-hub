/**
 * 价格速查策展台(M55 批A):/pricing/ 公开页的数据治理面——上半区模型牌价、
 * 下半区 Coding Plan 套餐。三通道数据(OpenRouter 预填/官方页爬虫/手工)统一
 * 落 pending,本页人工终审 enabled。服务端直查不设读 API 渲染依赖。
 */
import ModelsBoard from "@/components/admin/pricing/ModelsBoard";
import PlansBoard from "@/components/admin/pricing/PlansBoard";
import { requireAdminPage } from "@/lib/auth/guard";
import { listCodingPlans, listModelPricing } from "@/lib/pricing/admin";

export const dynamic = "force-dynamic";

export default async function AdminPricingPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const [models, plans] = await Promise.all([listModelPricing(), listCodingPlans()]);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold">价格速查</h2>
        <p className="mt-0.5 text-xs text-text-3">
          /pricing/ 公开页的数据源:官方一手牌价人工策展 · 三通道数据均落「待审」,点状态钮终审发布 ·
          额度口径按官方原文呈现
        </p>
      </div>
      <ModelsBoard rows={models} />
      <PlansBoard rows={plans} />
    </div>
  );
}
