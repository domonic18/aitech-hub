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
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/site/PageHeader";
import type { PriceBandId, PublicPricing } from "@/lib/pricing/public";
import {
  decodePricingQuery,
  DEFAULT_PRICING_QUERY,
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
  const pathname = usePathname();

  /**
   * 筛选态**不从 useSearchParams 读**:那会让整块交互组件必须包在
   * `<Suspense fallback={null}>` 里——静态预渲染时 fallback 吞掉全部内容,
   * SSR HTML 变成空壳(只有客户端水合后才有内容),SEO 生命线断。
   * 这里改成:SSR 照旧输出**未筛选的全量**,挂载后从 window.location 读 URL
   * 覆盖筛选态,写回用 history.replaceState(不触发 Next 路由变更)。
   */
  const [modelQuery, setModelQuery] = useState<PricingQueryState>(DEFAULT_PRICING_QUERY);
  const [planVendors, setPlanVendors] = useState<string[]>([]);
  const [planBand, setPlanBand] = useState<PriceBandId>("all");
  const [sortByPrice, setSortByPrice] = useState(false);
  const [compareKeys, setCompareKeys] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  // 挂载后从 URL 取初始筛选(SSR 已输出未筛选全量,这里只是覆盖成 URL 指定的状态)
  useEffect(() => {
    const fromUrl = decodePricingQuery(window.location.search);
    setModelQuery((prev) => (samePricingQuery(prev, fromUrl) ? prev : fromUrl));
    const onPop = (): void => {
      const next = decodePricingQuery(window.location.search);
      setModelQuery((prev) => (samePricingQuery(prev, next) ? prev : next));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // 筛选态 → URL(replaceState:不触发 Next 路由变更,也不新增历史条目)
  useEffect(() => {
    const qs = encodePricingQuery(modelQuery);
    const target = qs === "" ? pathname : `${pathname}?${qs}`;
    if (target !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, "", target);
    }
  }, [modelQuery, pathname]);

  const updateModelQuery = useCallback((patch: Partial<PricingQueryState>): void => {
    setModelQuery((prev) => ({ ...prev, ...patch }));
  }, []);

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
              cat={modelQuery.cat}
              onCatChange={(c) =>
                // 非文本组无上下文概念,切组时复位上下文档(否则空筛)
                updateModelQuery({
                  cat: c,
                  ...(c === "text" || c === "all" ? {} : { contextBand: "all" }),
                })
              }
              contextBand={modelQuery.contextBand}
              onContextBandChange={(v) => updateModelQuery({ contextBand: v })}
              sourceKind={modelQuery.sourceKind}
              onSourceKindChange={(v) => updateModelQuery({ sourceKind: v })}
              sort={modelQuery.sort}
              onSortChange={(v) => updateModelQuery({ sort: v })}
              view={modelQuery.view}
              onViewChange={(v) => updateModelQuery({ view: v })}
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
