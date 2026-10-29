/**
 * 牌价管理(M55 批A 建;M56 验收 IA 归位 2026-10-29:自「数据」组迁「内容」组
 * 并更名——公开页叫价格速查,后台叫牌价管理,各归其位):/pricing/ 公开页的
 * 数据治理面,双页签(模型牌价 | Coding Plan,PricingConsole)。
 * 渠道维护统一在 数据中心·源管理·采集渠道(M56 验收反馈:crawl_source
 * type=pricing,URL/启停/采集周期后台可调,采集频率默认周级)。
 * (批B OpenRouter 预填通道已砍除——非刚需,2026-10-29 用户拍板)
 */
import Link from "next/link";

import PricingConsole from "@/components/admin/pricing/PricingConsole";
import { requireAdminPage } from "@/lib/auth/guard";
import { listCodingPlans, listModelPricing } from "@/lib/pricing/admin";

export const dynamic = "force-dynamic";

export default async function AdminPricingPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const [models, plans] = await Promise.all([listModelPricing(), listCodingPlans()]);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">牌价管理</h2>
        <p className="text-xs text-text-3">
          /pricing/ 公开页「价格速查」的数据源:官方爬虫/手工落「待审」,终审发布 ·
          额度口径按官方原文呈现 · 渠道采集在
          <Link href="/admin/data/sources/" className="mx-0.5 text-accent hover:underline">
            数据中心·源管理
          </Link>
          维护(URL/启停/采集周期)
        </p>
      </div>
      <PricingConsole models={models} plans={plans} />
    </div>
  );
}
