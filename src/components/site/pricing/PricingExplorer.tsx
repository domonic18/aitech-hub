"use client";

/**
 * /pricing/ 交互根(验收问题一/三,2026-10-29;M74 批C 增筛选维度与 URL 同步):
 * 筛选状态与对比选集住在这里,两个面板各持一份筛选(模型按输入价、套餐按月费,
 * 量纲不同不共用区间)。客户端渲染≠SEO 退化:全量行由 RSC 传参,首屏 HTML 仍
 * SSR 全量(ISR 600s)。
 *
 * 页内大页签(2026-11-18):「模型调用(按量)| Coding Plan(订阅)」两个一级
 * 页签分开两类计费形态(URL 参数 panel,默认 model);非活动页签整块 hidden
 * 藏住——内容仍在 HTML 里,SEO 红线不破;套餐对比托盘跟随套餐页签。
 *
 * 筛选态同步到 URL(query 参数):可分享/可收藏/可后退,且**不改页面渲染方式**
 * ——URL 只驱动客户端筛选,页仍是 ISR 静态(SEO 生命线)。
 */
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/site/PageHeader";
import type { PriceBandId, PublicPricing, TierParamFilter } from "@/lib/pricing/public";
import type { LeaderboardBadge } from "@/lib/pricing/leaderboard-ref";
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

/** pf URL 串 → TierParamFilter(如 "res:1080p,au:1,dur:5") */
function tierParamFilterOf(pf: string): TierParamFilter {
  const out: TierParamFilter = {};
  for (const kv of pf.split(",")) {
    const [k, v] = kv.split(":");
    if (k === "res" && v) out.resolution = v;
    else if (k === "au" && v === "1") out.hasAudio = true;
    else if (k === "au" && v === "0") out.hasAudio = false;
    else if (k === "dur" && v) {
      const d = Number(v);
      if (Number.isFinite(d)) out.durationGte = d;
    }
  }
  return out;
}

/** TierParamFilter → pf URL 串 */
function encodeTierParamFilter(f: TierParamFilter): string {
  const parts: string[] = [];
  if (f.resolution !== undefined) parts.push(`res:${f.resolution}`);
  if (f.hasAudio === true) parts.push("au:1");
  if (f.hasAudio === false) parts.push("au:0");
  if (f.durationGte !== undefined) parts.push(`dur:${f.durationGte}`);
  return parts.join(",");
}

/** 对比上限:超过 4 列并排在小屏失去可读性 */
const COMPARE_LIMIT = 4;

export default function PricingExplorer({
  data,
  changeCount = 0,
  leaderboardMap = new Map(),
}: {
  data: PublicPricing;
  /** 近 90 天降价记录条数(服务端查好传入,只做入口链接的文案) */
  changeCount?: number;
  /** 模型外部榜单角标(P5) */
  leaderboardMap?: Map<string, LeaderboardBadge[]>;
}): React.ReactElement {
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
  // 页内大页签(2026-11-18 反馈:按量模型与 Coding Plan 挤一页不利查看):
  // 两块内容都 SSR 全量进 HTML(SEO 红线),非活动页签整块 hidden 藏住——
  // 与列表视图藏行同源技巧;套餐对比托盘跟随套餐页签
  const showTabs = data.models.length > 0 && data.plans.length > 0;
  const panel = modelQuery.panel;
  const trayVisible = compareKeys.length > 0 && (!showTabs || panel === "plan");

  return (
    <PageHeader
      eyebrow="TOOL HOOK · 工具钩子 01"
      title="AI 模型价格速查"
      description="主流大模型官方牌价一觉:模型按量调用输入 / 输出价、免费额度与上下文窗口,Coding Plan 订阅套餐额度与权益。可按厂商、价格区间、模态、上下文与来源类型筛选,只看免费模型,勾选套餐横向比价。价格以各厂商官方页面为准。"
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
          {showTabs && (
            <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="计费方式">
              {[
                { id: "model" as const, label: "模型调用", sub: "按量计费", n: data.models.length },
                {
                  id: "plan" as const,
                  label: "Coding Plan",
                  sub: "订阅套餐",
                  n: data.plans.length,
                },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={panel === t.id}
                  onClick={() => updateModelQuery({ panel: t.id })}
                  className={`rounded-full border px-3.5 py-1.5 text-[13px] leading-none transition-colors cursor-pointer select-none ${
                    panel === t.id
                      ? "border-accent bg-accent text-white"
                      : "border-line bg-panel text-text-2 hover:border-line-hover hover:text-text-1"
                  }`}
                >
                  {t.label}
                  <span className={panel === t.id ? "ml-1.5 opacity-80" : "ml-1.5 text-text-3"}>
                    {t.sub} · {t.n}
                  </span>
                </button>
              ))}
            </div>
          )}

          {data.models.length > 0 && (
            <div hidden={showTabs && panel !== "model"}>
              <ModelSection
                models={data.models}
                selectedVendors={modelQuery.vendors}
                onVendorsChange={(v) => updateModelQuery({ vendors: v })}
                band={modelQuery.band}
                onBandChange={(b) => updateModelQuery({ band: b })}
                freeScope={modelQuery.freeScope}
                onFreeScopeChange={(v) => updateModelQuery({ freeScope: v })}
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
                scenario={modelQuery.scenario}
                onScenarioChange={(v) => updateModelQuery({ scenario: v })}
                q={modelQuery.q}
                onQChange={(v) => updateModelQuery({ q: v })}
                pmin={modelQuery.pmin}
                pmax={modelQuery.pmax}
                onPriceRangeChange={(min, max) =>
                  updateModelQuery({
                    pmin: min,
                    pmax: max,
                    ...(min !== null || max !== null ? { band: "all" as const } : {}),
                  })
                }
                tierParamFilter={tierParamFilterOf(modelQuery.pf)}
                onTierParamFilterChange={(v) => updateModelQuery({ pf: encodeTierParamFilter(v) })}
                leaderboardMap={leaderboardMap}
              />
              {/* 降价史入口(M74 批F):独立路由,SSR 直出(爬虫可抓),不改本页首屏结构 */}
              <p className="mt-3 text-[11.5px] text-text-3">
                {changeCount > 0 ? (
                  <>
                    近 90 天有 <span className="font-mono text-text-1">{changeCount}</span> 条降价
                    记录 ·{" "}
                  </>
                ) : (
                  <>降价记录自牌价监测上线后开始累计 · </>
                )}
                <Link href="/pricing/changes/" className="text-blue hover:text-blue/80">
                  查看降价记录
                </Link>
              </p>
            </div>
          )}
          {data.plans.length > 0 && (
            <div hidden={showTabs && panel !== "plan"}>
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
              {/* 托盘浮层让出底部空间,避免遮住末行/页脚 */}
              {trayVisible && <div className="h-20" aria-hidden />}
            </div>
          )}
        </>
      )}

      {trayVisible && (
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
      )}
      {compareOpen && selectedPlans.length >= 2 && (
        <CompareDialog plans={selectedPlans} onClose={() => setCompareOpen(false)} />
      )}
    </PageHeader>
  );
}
