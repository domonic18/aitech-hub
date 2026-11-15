"use client";

/**
 * /pricing/ 交互根(验收问题一/三,2026-10-29;M74 批C 增筛选维度与 URL 同步):
 * 筛选状态与对比选集住在这里,两个面板各持一份筛选(模型按输入价、套餐按月费,
 * 量纲不同不共用区间)。客户端渲染≠SEO 退化:全量行由 RSC 传参,首屏 HTML 仍
 * SSR 全量(ISR 600s)。
 *
 * 筛选态同步到 URL(query 参数):可分享/可收藏/可后退,且**不改页面渲染方式**
 * ——URL 只驱动客户端筛选,页仍是 ISR 静态(SEO 生命线)。
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PageHeader } from "@/components/site/PageHeader";
import type { PriceBandId, PublicPricing } from "@/lib/pricing/public";
import {
  decodePricingQuery,
  encodePricingQuery,
  samePricingQuery,
  type PricingQueryState,
} from "@/lib/pricing/query";

import { CompareDialog } from "./CompareDialog";
import { CompareTray } from "./CompareTray";
import { ModelSection } from "./ModelSection";
import { PlanSection } from "./PlanSection";
import { StatusBanner } from "./StatusBanner";
import { planKey } from "./shared";

/** 对比上限:超过 4 列并排在小屏失去可读性 */
const COMPARE_LIMIT = 4;

export default function PricingExplorer({ data }: { data: PublicPricing }): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [modelQuery, setModelQuery] = useState<PricingQueryState>(() =>
    decodePricingQuery(searchParams),
  );
  const [planVendors, setPlanVendors] = useState<string[]>([]);
  const [planBand, setPlanBand] = useState<PriceBandId>("all");
  const [sortByPrice, setSortByPrice] = useState(false);
  const [compareKeys, setCompareKeys] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  // 只有用户改动才写回 URL(避免挂载时抹掉 utm 等无关参数)
  const dirty = useRef(false);
  const updateModelQuery = useCallback((patch: Partial<PricingQueryState>): void => {
    dirty.current = true;
    setModelQuery((prev) => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    if (!dirty.current) return;
    dirty.current = false;
    const qs = encodePricingQuery(modelQuery);
    router.replace(qs === "" ? pathname : `${pathname}?${qs}`, { scroll: false });
  }, [modelQuery, pathname, router]);

  // 浏览器前进/后退:URL 变了就把状态拉回来
  useEffect(() => {
    const next = decodePricingQuery(searchParams);
    setModelQuery((prev) => (samePricingQuery(prev, next) ? prev : next));
  }, [searchParams]);

  // 选集按 data.plans 原序解析:筛选变化不影响已选(跨筛选也能凑齐对比)
  const selectedPlans = useMemo(
    () => data.plans.filter((p) => compareKeys.includes(planKey(p))),
    [data.plans, compareKeys],
  );

  const toggleCompare = (key: string): void => {
    setCompareKeys((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= COMPARE_LIMIT) return prev; // 满额静默忽略(勾选框已禁用)
      return [...prev, key];
    });
  };

  const empty = data.models.length === 0 && data.plans.length === 0;

  return (
    <PageHeader
      eyebrow="TOOL HOOK · 工具钩子 01"
      title="AI 模型价格速查"
      description="主流大模型官方牌价一觉:输入 / 输出价、免费额度与上下文窗口,Coding Plan 套餐额度与权益。可按厂商、价格区间、模态、上下文与来源类型筛选,只看免费模型,勾选套餐横向比价。价格以各厂商官方页面为准。"
    >
      <div className="mt-5">
        <StatusBanner data={data} />
      </div>

      {empty ? (
        <p className="mt-6 rounded-lg border border-dashed border-line bg-panel px-4 py-10 text-center text-[13px] text-text-3">
          牌价数据上架中(爬虫初稿人工终审后发布)
        </p>
      ) : (
        <>
          {data.models.length > 0 && (
            <ModelSection
              models={data.models}
              selectedVendors={modelQuery.vendors}
              onVendorsChange={(v) => updateModelQuery({ vendors: v })}
              band={modelQuery.band}
              onBandChange={(b) => updateModelQuery({ band: b })}
              freeOnly={modelQuery.freeOnly}
              onToggleFree={() => updateModelQuery({ freeOnly: !modelQuery.freeOnly })}
              modality={modelQuery.modality}
              onModalityChange={(v) => updateModelQuery({ modality: v })}
              contextBand={modelQuery.contextBand}
              onContextBandChange={(v) => updateModelQuery({ contextBand: v })}
              sourceKind={modelQuery.sourceKind}
              onSourceKindChange={(v) => updateModelQuery({ sourceKind: v })}
              sort={modelQuery.sort}
              onSortChange={(v) => updateModelQuery({ sort: v })}
            />
          )}
          {data.plans.length > 0 && (
            <PlanSection
              plans={data.plans}
              selectedVendors={planVendors}
              onVendorsChange={setPlanVendors}
              band={planBand}
              onBandChange={setPlanBand}
              sortByPrice={sortByPrice}
              onToggleSort={() => setSortByPrice((v) => !v)}
              compareKeys={compareKeys}
              onToggleCompare={toggleCompare}
              compareLimit={COMPARE_LIMIT}
            />
          )}
          {/* 托盘浮层让出底部空间,避免遮住末行/页脚 */}
          {compareKeys.length > 0 && <div className="h-20" aria-hidden />}
        </>
      )}

      <CompareTray
        plans={selectedPlans}
        onRemove={(key) => setCompareKeys((prev) => prev.filter((k) => k !== key))}
        onClear={() => {
          setCompareKeys([]);
          setCompareOpen(false);
        }}
        onOpen={() => setCompareOpen(true)}
        limit={COMPARE_LIMIT}
      />
      {compareOpen && selectedPlans.length >= 2 && (
        <CompareDialog plans={selectedPlans} onClose={() => setCompareOpen(false)} />
      )}
    </PageHeader>
  );
}
