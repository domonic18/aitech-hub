/**
 * 用量统计页(M14 批⑦,验收反馈问题8;原型 admin-usage.html):KPI×4
 * (tokens/估算费用/ASR 转写/降级次数)+ 日消耗趋势 + 按任务/按模型分布 +
 * 模型明细表(spark 趋势)。费用读时按牌价现折算,仅作预算参考;
 * 窗口 7/30/90 天(链接切换),RSC 直聚合一屏出数(轻聚合,无需客户端)。
 */
import Link from "next/link";

import Sparkline from "@/components/admin/usage/Sparkline";
import UsageDist from "@/components/admin/usage/UsageDist";
import UsagePurgeButton from "@/components/admin/usage/UsagePurgeButton";
import UsageTrend from "@/components/admin/usage/UsageTrend";
import {
  fmtCost,
  fmtHours,
  fmtInt,
  fmtTokens,
  usageRoleMeta,
} from "@/components/admin/usage/usage-format";
import { requireAdminPage } from "@/lib/auth/guard";
import { formatCnDateTime } from "@/lib/datetime";
import { getUsageOverview } from "@/lib/ai/usage-queries";

export const dynamic = "force-dynamic";

const DAY_OPTIONS = [7, 30, 90] as const;
type DaysOption = (typeof DAY_OPTIONS)[number];

function parseDays(v: string | undefined): DaysOption {
  return (DAY_OPTIONS as readonly number[]).includes(Number(v)) ? (Number(v) as DaysOption) : 30;
}

/** 环比文案(涨红跌绿?原型反着:涨 +12.4% 绿色 b——对齐原型用 green,负值 amber) */
function deltaSub(tokens: number, prev: number): React.ReactElement {
  if (prev === 0) {
    return <span>上期无数据</span>;
  }
  const pct = ((tokens - prev) / prev) * 100;
  const up = pct >= 0;
  return (
    <span>
      环比上期{" "}
      <b className={up ? "font-medium text-green" : "font-medium text-amber"}>
        {up ? "+" : ""}
        {pct.toFixed(1)}%
      </b>
    </span>
  );
}

function KpiCard({
  icon,
  label,
  children,
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-panel px-4 py-4">
      <div className="flex items-center gap-1.5 text-[12.5px] text-text-2">
        <svg className="ic text-accent" aria-hidden="true">
          <use href={`#${icon}`} />
        </svg>
        {label}
      </div>
      {children}
    </div>
  );
}

export default async function AdminUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const { days: daysParam } = await searchParams;
  const days = parseDays(daysParam);
  const o = await getUsageOverview(days);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">用量统计</h2>
        <p className="mt-0.5 text-xs text-text-3">
          AI 服务 Token 消耗看板:按任务类型与模型聚合 tokens
          与费用;费用按供应商牌价折算,仅作预算参考。
        </p>
      </div>

      {/* 工具条:窗口切换(链接式,保持 RSC)+ 清理明细 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-sm border border-line">
          {DAY_OPTIONS.map((d) => (
            <Link
              key={d}
              href={`/admin/usage?days=${d}`}
              className={`px-4 py-[7px] font-mono text-[13px] transition-colors ${
                d === days
                  ? "bg-accent/10 font-semibold text-accent"
                  : "bg-panel text-text-2 hover:text-text-1"
              }`}
            >
              近 {d} 天
            </Link>
          ))}
        </div>
        <span className="ml-auto">
          <UsagePurgeButton />
        </span>
      </div>

      {/* KPI ×4(原型 kpi-grid) */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon="i-experiment" label="Tokens 消耗">
          <div className="mt-2 font-mono text-[26px] font-bold leading-none tracking-[-0.01em]">
            {fmtTokens(o.kpi.tokens)}
            <small className="ml-1 text-[13px] font-normal text-text-3">tokens</small>
          </div>
          <div className="mt-1.5 text-[11.5px] text-text-3">
            {deltaSub(o.kpi.tokens, o.kpi.prevTokens)}
          </div>
        </KpiCard>
        <KpiCard icon="i-global" label="估算费用">
          <div className="mt-2 font-mono text-[26px] font-bold leading-none tracking-[-0.01em]">
            {fmtCost(o.kpi.cost)}
          </div>
          <div className="mt-1.5 text-[11.5px] text-text-3">按各供应商牌价折算(读时现折)</div>
        </KpiCard>
        <KpiCard icon="i-sound" label="ASR 转写">
          <div className="mt-2 font-mono text-[26px] font-bold leading-none tracking-[-0.01em]">
            {fmtHours(o.kpi.asrHours * 3600)}
            <small className="ml-1 text-[13px] font-normal text-text-3">音频</small>
          </div>
          <div className="mt-1.5 text-[11.5px] text-text-3">
            {fmtCost(o.kpi.asrCost)} · {fmtInt(o.kpi.asrCount)} 个音频
          </div>
        </KpiCard>
        <KpiCard icon="i-warning" label="降级次数">
          <div className="mt-2 font-mono text-[26px] font-bold leading-none tracking-[-0.01em]">
            {o.kpi.degradedAsr + o.kpi.degradedLlm}
            <small className="ml-1 text-[13px] font-normal text-text-3">次</small>
          </div>
          <div className="mt-1.5 text-[11.5px] text-text-3">
            <b className="font-medium text-amber">
              ASR {o.kpi.degradedAsr} · LLM {o.kpi.degradedLlm}
            </b>
            ,自动切备用/缺转写降级
          </div>
        </KpiCard>
      </div>

      {/* 趋势 + 双分布(原型 mid-grid) */}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rounded-md border border-line bg-panel pb-3">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3.5 text-sm font-semibold">
            <svg className="ic text-accent" aria-hidden="true">
              <use href="#i-linechart" />
            </svg>
            日消耗趋势
            <span className="ml-auto font-mono text-[11px] font-normal text-text-3">
              tokens / 天
            </span>
          </div>
          <UsageTrend daily={o.daily} />
          <div className="flex justify-between px-4 pt-1.5 font-mono text-[10.5px] text-text-3">
            <span>{o.daily[0]?.date}</span>
            <span>{o.daily[Math.floor(o.daily.length / 2)]?.date}</span>
            <span>{o.daily[o.daily.length - 1]?.date}</span>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-line bg-panel">
            <div className="border-b border-line px-4 py-3.5 text-sm font-semibold">按任务分布</div>
            <UsageDist rows={o.byRole.map((r) => ({ ...r, key: usageRoleMeta(r.key).label }))} />
          </div>
          <div className="rounded-md border border-line bg-panel">
            <div className="border-b border-line px-4 py-3.5 text-sm font-semibold">按模型分布</div>
            <UsageDist rows={o.byModel} />
          </div>
        </div>
      </div>

      {/* 模型明细(原型 a-table:任务/模型/调用/Prompt/补全/合计/费用/最近/趋势) */}
      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="bg-panel-2 text-text-2">
              <th className="px-3.5 py-3 font-semibold">任务</th>
              <th className="px-3.5 py-3 font-semibold">模型</th>
              <th className="px-3.5 py-3 text-right font-semibold">调用</th>
              <th className="px-3.5 py-3 text-right font-semibold">Prompt</th>
              <th className="px-3.5 py-3 text-right font-semibold">补全</th>
              <th className="px-3.5 py-3 text-right font-semibold">合计</th>
              <th className="px-3.5 py-3 text-right font-semibold">费用</th>
              <th className="px-3.5 py-3 font-semibold">最近使用</th>
              <th className="px-3.5 py-3 font-semibold">{days} 日趋势</th>
            </tr>
          </thead>
          <tbody>
            {o.rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3.5 py-8 text-center text-xs text-text-3">
                  窗口内暂无 AI 调用(台账逐次落 ai_usage_log;90 天保留期)
                </td>
              </tr>
            ) : (
              o.rows.map((r) => {
                const meta = usageRoleMeta(r.role);
                return (
                  <tr
                    key={`${r.role}-${r.modelKey}`}
                    className="border-t border-line hover:bg-panel-2"
                  >
                    <td className="px-3.5 py-3">
                      <span
                        className={`rounded border px-2 py-px font-mono text-[11px] ${meta.cls}`}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3.5 py-3 font-mono text-[12.5px]">
                      {r.modelKey}
                    </td>
                    <td className="px-3.5 py-3 text-right font-mono text-[12.5px]">
                      {fmtInt(r.calls)}
                    </td>
                    <td className="px-3.5 py-3 text-right font-mono text-[12.5px]">
                      {r.tokensIn > 0 ? fmtTokens(r.tokensIn) : "—"}
                    </td>
                    <td className="px-3.5 py-3 text-right font-mono text-[12.5px]">
                      {r.tokensOut > 0 ? fmtTokens(r.tokensOut) : "—"}
                    </td>
                    <td className="px-3.5 py-3 text-right font-mono text-[12.5px] font-semibold">
                      {r.tokensIn + r.tokensOut > 0 ? fmtTokens(r.tokensIn + r.tokensOut) : "—"}
                    </td>
                    <td className="px-3.5 py-3 text-right font-mono text-[12.5px]">
                      {fmtCost(r.cost)}
                    </td>
                    <td className="whitespace-nowrap px-3.5 py-3 font-mono text-[12.5px] text-text-3">
                      {formatCnDateTime(r.lastUsed)}
                    </td>
                    <td className="px-3.5 py-3">
                      <Sparkline data={r.spark} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <div className="border-t border-line px-4 py-3 font-mono text-xs text-text-3">
          保留期 90 天(worker 每日 04:52 清理,或右上角手动清理);费用= tokens×牌价(¥/1M)+ 生图按张 +
          ASR 按音频时长,failed 行不计费。
        </div>
      </div>
    </div>
  );
}
