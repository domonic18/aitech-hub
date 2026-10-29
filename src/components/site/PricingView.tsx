/**
 * /pricing/ 视图(M55 批D,Ardot P1 桌面定稿 2026-10-28「这一版设计很好」):
 * 工具钩子 eyebrow + 状态横幅(整表数据截至;超 45 天转琥珀提醒 D5)+
 * 双表面板——模型牌价按 国内/国际 分组(组头币种口径+计数徽章,USD 原币
 * 直出 D4),Coding Plan 套餐(额度口径原文直出 D3,峰谷倍率琥珀)。
 * 移动端表格降维卡片(P2 口径,纯 CSS 无 JS);停用/待审行服务端已滤
 * (仅 enabled),本组件零状态纯展示,取数在页面侧(ISR 600s)。
 */
import Link from "next/link";

import { formatPrice, isPricingStale, PRICING_STALE_DAYS } from "@/lib/pricing/public";
import type { PublicModelRow, PublicPlanRow, PublicPricing } from "@/lib/pricing/public";

const REGION_TITLES: Record<string, string> = { cn: "国内厂商", intl: "国际厂商" };
const CURRENCY_UNITS: Record<string, string> = {
  CNY: "人民币 ¥ / 百万 tokens",
  USD: "美元 $ / 百万 tokens(原币直出)",
};

/** 分组键 = region×currency(组头币种口径必须与组内行一致,不说谎):
 * 终审后的常态数据收敛为 国内·¥ / 国际·$ 两组(同 P1 定稿);若上架异币种
 * 行(如国际厂商 CNY 报价),独立成组如实标注,不混组误导 */
function groupKey(r: PublicModelRow): string {
  return `${r.region}|${r.currency}`;
}

function groupTitle(key: string, rows: PublicModelRow[]): string {
  const [region] = key.split("|");
  return `${REGION_TITLES[region ?? ""] ?? region} · ${CURRENCY_UNITS[rows[0]!.currency ?? ""] ?? rows[0]!.currency}`;
}

/** YYYY-MM-DD → 北京日界 Date(与写入侧 formatCnDate 口径对齐) */
function asOfDate(s: string): Date {
  return new Date(`${s}T00:00:00+08:00`);
}

function OfficialLink({ url }: { url: string }): React.ReactElement {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[12px] text-blue hover:text-blue/80"
    >
      官方
    </a>
  );
}

function StatusBanner({ data }: { data: PublicPricing }): React.ReactElement {
  const overall = [data.modelsAsOf, data.plansAsOf]
    .filter((s): s is string => s !== null)
    .sort()
    .at(-1);
  const stale =
    isPricingStale(data.modelsAsOf === null ? null : asOfDate(data.modelsAsOf), new Date()) ||
    isPricingStale(data.plansAsOf === null ? null : asOfDate(data.plansAsOf), new Date());
  return (
    <div
      className={`rounded-lg border px-4 py-2.5 text-[12.5px] leading-relaxed ${
        stale ? "border-amber/30 bg-amber/8 text-amber" : "border-line bg-panel text-text-2"
      }`}
    >
      <i className={`mr-2 inline-block h-2 w-2 rounded-full ${stale ? "bg-amber" : "bg-green"}`} />
      {overall === null ? (
        <span>牌价上架中,先看看</span>
      ) : stale ? (
        <span>
          数据截至 {overall} · 已超 {PRICING_STALE_DAYS} 天未核对,价格可能过期 ·
          <span className="text-amber"> 请以官方页面为准</span>
        </span>
      ) : (
        <span>
          数据截至 {overall} ·
          <span className="text-green">
            API 牌价 + Coding Plan 双维度 · 每月人工核对更新 · 以官方页面为准
          </span>
        </span>
      )}
    </div>
  );
}

function ModelTable({ rows }: { rows: PublicModelRow[] }): React.ReactElement {
  return (
    <div className="hidden sm:block">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line text-[11px] font-normal text-text-3">
            <th className="px-4 py-2.5 font-normal">模型 / 厂商</th>
            <th className="px-3 py-2.5 font-normal">输入价</th>
            <th className="px-3 py-2.5 font-normal">输出价</th>
            <th className="px-3 py-2.5 font-normal">免费额度</th>
            <th className="px-3 py-2.5 font-normal">上下文</th>
            <th className="px-3 py-2.5 font-normal">数据截至</th>
            <th className="px-4 py-2.5 text-right font-normal">来源</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.vendor}|${r.modelKey}`} className="border-b border-line/50 last:border-0">
              <td className="px-4 py-3.5">
                <div className="font-mono text-[13px] font-semibold text-text-1">{r.modelKey}</div>
                <div className="mt-0.5 text-[11px] text-text-3">{r.vendor}</div>
              </td>
              <td className="px-3 py-3.5 font-mono text-text-1">
                {formatPrice(r.inputPrice, r.currency)}
              </td>
              <td className="px-3 py-3.5 font-mono text-text-1">
                {formatPrice(r.outputPrice, r.currency)}
              </td>
              <td className="px-3 py-3.5 text-[12px]">
                {r.freeTier === null ? (
                  <span className="text-text-3">—</span>
                ) : (
                  <span className="text-amber">{r.freeTier}</span>
                )}
              </td>
              <td className="px-3 py-3.5 font-mono text-[12px] text-text-3">
                {r.contextWindow ?? "—"}
              </td>
              <td className="px-3 py-3.5 font-mono text-[12px] text-text-3">
                {r.dataAsOf.slice(5)}
              </td>
              <td className="px-4 py-3.5 text-right">
                <OfficialLink url={r.sourceUrl} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelCards({ rows }: { rows: PublicModelRow[] }): React.ReactElement {
  return (
    <div className="flex flex-col gap-3 sm:hidden">
      {rows.map((r) => (
        <div
          key={`${r.vendor}|${r.modelKey}`}
          className="rounded-lg border border-line/70 px-4 py-3"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[13px] font-semibold text-text-1">{r.modelKey}</span>
            <OfficialLink url={r.sourceUrl} />
          </div>
          <div className="mt-0.5 text-[11px] text-text-3">{r.vendor}</div>
          <div className="mt-2 flex gap-5 font-mono text-[13px] text-text-1">
            <span>
              <span className="mr-1 text-[10.5px] font-normal text-text-3">输入</span>
              {formatPrice(r.inputPrice, r.currency)}
            </span>
            <span>
              <span className="mr-1 text-[10.5px] font-normal text-text-3">输出</span>
              {formatPrice(r.outputPrice, r.currency)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-3">
            {r.freeTier !== null && <span className="text-amber">免费额度:{r.freeTier}</span>}
            {r.contextWindow !== null && <span>上下文 {r.contextWindow}</span>}
            <span>截至 {r.dataAsOf}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 周期价直显行(验收问题一 2026-10-29:比价所需季/年不必展开;口径原文 title) */
function PlanCycleLines({ r }: { r: PublicPlanRow }): React.ReactElement | null {
  if (r.quarterlyFee === null && r.yearlyFee === null) return null;
  return (
    <div
      className="mt-1 font-mono text-[10.5px] leading-relaxed text-text-3"
      title={r.billingNote ?? undefined}
    >
      {r.quarterlyFee !== null && <div>季付 ¥ {r.quarterlyFee}/月</div>}
      {r.yearlyFee !== null && <div>年付 ¥ {r.yearlyFee}</div>}
    </div>
  );
}

/** 权益详情+来源(details 展开收起,零 JS 贴 D6;周期价已直显不在此) */
function PlanBenefitsDetails({ r }: { r: PublicPlanRow }): React.ReactElement | null {
  if (r.benefits === null || r.benefits.length === 0) return null;
  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer select-none text-[11px] text-accent hover:text-accent-hover">
        权益详情
      </summary>
      <div className="mt-1.5 flex flex-col gap-1 text-[11.5px] leading-relaxed text-text-2">
        {r.billingNote !== null && <div className="text-text-3">{r.billingNote}</div>}
        <ul className="mt-0.5 flex list-disc flex-col gap-0.5 pl-4">
          {r.benefits.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        {/* 验收问题三:来源页直达(数据可溯源) */}
        <div>
          来源:
          <a
            href={r.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue hover:text-blue/80"
          >
            官方页↗
          </a>
        </div>
      </div>
    </details>
  );
}

function PlanTable({ rows }: { rows: PublicPlanRow[] }): React.ReactElement {
  const peakText = (r: PublicPlanRow): string =>
    [r.peakRate, r.offPeakRate].filter(Boolean).join(" · ");
  return (
    <>
      <div className="hidden sm:block">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-[11px] font-normal text-text-3">
              <th className="px-4 py-2.5 font-normal">厂商 · 套餐</th>
              <th className="px-3 py-2.5 font-normal">月费</th>
              <th className="px-3 py-2.5 font-normal">额度口径</th>
              <th className="px-3 py-2.5 font-normal">时段扣费</th>
              <th className="px-4 py-2.5 font-normal">适合</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.vendor}|${r.planName}`}
                className="border-b border-line/50 last:border-0"
              >
                <td className="px-4 py-3.5">
                  <div className="text-[13px] font-semibold text-text-1">{r.planName}</div>
                  <div className="mt-0.5 text-[11px] text-text-3">{r.vendor}</div>
                  <PlanBenefitsDetails r={r} />
                </td>
                <td className="px-3 py-3.5 font-mono text-text-1">
                  {formatPrice(r.monthlyFee, r.currency)}
                  <PlanCycleLines r={r} />
                </td>
                <td className="px-3 py-3.5 text-[12.5px] text-text-2">{r.quotaDesc}</td>
                <td className="px-3 py-3.5 font-mono text-[12px] text-amber">
                  {peakText(r) === "" ? <span className="text-text-3">—</span> : peakText(r)}
                </td>
                <td className="px-4 py-3.5 text-[12.5px] text-text-2">{r.bestFor ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3 sm:hidden">
        {rows.map((r) => (
          <div
            key={`${r.vendor}|${r.planName}`}
            className="rounded-lg border border-line/70 px-4 py-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-semibold text-text-1">{r.planName}</span>
              <span className="font-mono text-[13px] text-text-1">
                {formatPrice(r.monthlyFee, r.currency)}/月
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-text-3">{r.vendor}</div>
            <div className="mt-2 text-[12.5px] text-text-2">额度:{r.quotaDesc}</div>
            <PlanCycleLines r={r} />
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
              {peakText(r) !== "" && <span className="font-mono text-amber">{peakText(r)}</span>}
              {r.bestFor !== null && <span className="text-text-3">适合:{r.bestFor}</span>}
            </div>
            <PlanBenefitsDetails r={r} />
          </div>
        ))}
      </div>
    </>
  );
}

export default function PricingView({ data }: { data: PublicPricing }): React.ReactElement {
  // 分组顺序:国内¥ → 国际$ → 其余混合组(region×currency 字典序)
  const groups = [...new Set(data.models.map(groupKey))].sort((a, b) => {
    const rank = (k: string): number => (k === "cn|CNY" ? 0 : k === "intl|USD" ? 1 : 2);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  const vendorCount = new Set(data.models.map((m) => m.vendor)).size;
  return (
    <section className="mx-auto w-full max-w-[var(--site-max-w)]">
      <p className="font-mono text-[11px] tracking-[0.2em] text-blue">TOOL HOOK · 工具钩子 01</p>
      <h1 className="mt-3 text-2xl font-bold sm:text-3xl">AI 模型价格速查</h1>
      <p className="mt-2.5 max-w-2xl text-[13.5px] leading-relaxed text-text-2">
        主流大模型官方牌价一觉:输入 /
        输出价、免费额度与上下文窗口。每月人工核对更新,价格以各厂商官方页面为准。
      </p>
      <div className="mt-5">
        <StatusBanner data={data} />
      </div>

      {data.models.length === 0 && data.plans.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-line bg-panel px-4 py-10 text-center text-[13px] text-text-3">
          牌价数据上架中(爬虫初稿人工终审后发布)
        </p>
      ) : (
        <>
          {data.models.length > 0 && (
            <div className="mt-6 overflow-hidden rounded-lg border border-line bg-panel shadow-sm">
              {groups.map((key, i) => {
                const rows = data.models.filter((m) => groupKey(m) === key);
                return (
                  <div key={key} className={i > 0 ? "border-t border-line" : ""}>
                    <div className="flex items-center gap-2 border-b border-line bg-panel-2/50 px-4 py-3">
                      <h2 className="text-[13px] font-semibold text-text-1">
                        {groupTitle(key, rows)}
                      </h2>
                      <span className="ml-auto font-mono text-[11px] text-blue">{rows.length}</span>
                    </div>
                    <ModelTable rows={rows} />
                    <ModelCards rows={rows} />
                  </div>
                );
              })}
              <p className="border-t border-line px-4 py-3 text-[11.5px] text-text-3">
                共 {data.models.length} 个模型 · v1 覆盖 {vendorCount} 家官方厂牌 ·
                完整列表随官方调价滚动更新
              </p>
            </div>
          )}

          {data.plans.length > 0 && (
            <div className="mt-6 overflow-hidden rounded-lg border border-line bg-panel shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line bg-panel-2/50 px-4 py-3">
                <h2 className="text-[13px] font-semibold text-text-1">Coding Plan 订阅套餐</h2>
                <p className="text-[11px] text-text-3">
                  额度口径各家不一,按官方原文呈现;时段扣费 = 额度在高峰/闲时的计费倍率
                </p>
              </div>
              <PlanTable rows={data.plans} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
