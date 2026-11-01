/**
 * 洞察中心·信号(M59 批A):原始信号流的独立榜单页——源 chips(带同筛选下
 * 各源条数)/ 地域 / 介质 / 日期范围 + 分页列表。原先埋在总览页末尾的折叠
 * 「信号明细」(50 条上限、无分页)迁出至此;筛选 chip 走 URL,与洞察各页
 * 同一套 chip 语法。分源计数不含当前源筛选(见 listInsightSignalsPage)。
 */
import Link from "next/link";

import type { InsightSignalPage } from "@/lib/insight/admin";
import { INSIGHT_MEDIA_VOCAB, MEDIUM_LABELS } from "@/lib/insight/constants";
import { INSIGHT_SOURCES_ENABLED, type InsightSource } from "@/lib/insight/ingest";
import { SIGNALS_PATH, signalsHref, type SignalFilters } from "@/lib/insight/signals-view";

import Pager from "./Pager";
import { PanelCard } from "./PanelCard";
import SignalRow from "./SignalRow";
import { REGIONS, REGION_LABELS, SOURCE_LABELS, chipOff, chipOn, shortSource } from "./shared";

/** 在役源(白名单序) */
const ENABLED_SOURCES = [...INSIGHT_SOURCES_ENABLED] as InsightSource[];

function Chip({
  on,
  href,
  children,
}: {
  on: boolean;
  href: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Link
      href={href}
      scroll={false}
      className={on ? chipOn : chipOff}
      aria-current={on || undefined}
    >
      {children}
    </Link>
  );
}

export default function SignalsBoard({
  data,
  filters,
}: {
  data: InsightSignalPage;
  filters: SignalFilters;
}): React.ReactElement {
  const countOf = new Map(data.bySource.map((r) => [r.source, r.count]));
  const totalAll = data.bySource.reduce((a, r) => a + r.count, 0);
  // 只展示当前筛选下有信号的源;当前选中的源即使 0 条也保留(让 chip 选中态可见)
  const sources = ENABLED_SOURCES.filter((s) => (countOf.get(s) ?? 0) > 0 || s === filters.source);
  /** 切源/介质/地域均回第 1 页;日期表单重置页码由 hidden page 省略天然达成 */
  const swap = (overrides: Partial<SignalFilters>): string =>
    signalsHref(filters, { ...overrides, page: 1 });

  return (
    <PanelCard
      title="信号明细"
      hint="小时级采集的原始信号流 · 译文优先、原文可展开 · 源间条数不可比(采集频率不同)"
      extra={
        <span className="font-mono text-[11px] text-text-3">
          共 {data.total.toLocaleString()} 条
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 pb-2">
        <Chip on={filters.source === undefined} href={swap({ source: undefined })}>
          全部源 {totalAll.toLocaleString()}
        </Chip>
        {sources.map((s) => (
          <Chip key={s} on={filters.source === s} href={swap({ source: s })}>
            {shortSource(s)} {countOf.get(s) ?? 0}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-2">
        <span className="text-[11px] text-text-3">地域</span>
        <Chip on={filters.region === undefined} href={swap({ region: undefined })}>
          全部
        </Chip>
        {REGIONS.map((r) => (
          <Chip key={r} on={filters.region === r} href={swap({ region: r })}>
            {REGION_LABELS[r]}
          </Chip>
        ))}
        <span className="ml-1 text-[11px] text-text-3">介质</span>
        <Chip on={filters.medium === undefined} href={swap({ medium: undefined })}>
          全部
        </Chip>
        {INSIGHT_MEDIA_VOCAB.map((m) => (
          <Chip key={m} on={filters.medium === m} href={swap({ medium: m })}>
            {MEDIUM_LABELS[m]}
          </Chip>
        ))}
        {/* 窄屏(≤360)两个原生日期框 + 查询占 ~300px,面板内只剩 ~296px →
            整条溢出面板;窄屏独占一行并允许日期框收缩(2026-10-30 验收) */}
        <form
          method="GET"
          action={SIGNALS_PATH}
          className="ml-auto flex w-full flex-wrap items-center gap-1.5 sm:w-auto"
        >
          {/* 跨提交保真:当前源/地域/介质随日期表单提交(页码回第 1 页) */}
          {filters.source !== undefined && (
            <input type="hidden" name="source" value={filters.source} />
          )}
          {filters.region !== undefined && (
            <input type="hidden" name="region" value={filters.region} />
          )}
          {filters.medium !== undefined && (
            <input type="hidden" name="medium" value={filters.medium} />
          )}
          <input
            type="date"
            name="from"
            defaultValue={filters.from ?? ""}
            aria-label="开始日期"
            className="rounded-sm border border-line bg-panel px-1.5 py-0.5 font-mono text-[11px] text-text-2"
          />
          <span className="text-[11px] text-text-3">→</span>
          <input
            type="date"
            name="to"
            defaultValue={filters.to ?? ""}
            aria-label="结束日期"
            className="rounded-sm border border-line bg-panel px-1.5 py-0.5 font-mono text-[11px] text-text-2"
          />
          <button
            type="submit"
            className="cursor-pointer rounded-sm border border-line bg-panel px-2 py-0.5 text-[11px] text-text-2 hover:border-line-hover hover:text-text-1"
          >
            查询
          </button>
          {(filters.from !== undefined || filters.to !== undefined) && (
            <Link
              href={swap({ from: undefined, to: undefined })}
              scroll={false}
              className="text-[11px] text-text-3 hover:text-accent"
            >
              清除
            </Link>
          )}
        </form>
      </div>

      {data.rows.length === 0 ? (
        <p className="px-3 py-8 text-center text-[13px] text-text-3">
          {filters.source === undefined ? (
            <>
              该范围内暂无信号:信号由外部热榜/社区源小时级采集产生——去
              <Link
                href="/admin/data/sources/?t=channels"
                className="mx-0.5 text-accent hover:underline"
              >
                源管理·采集渠道
              </Link>
              检查启停或手动拉取。
            </>
          ) : (
            `「${SOURCE_LABELS[filters.source]}」该范围内暂无信号,换个范围或等下一轮采集`
          )}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {data.rows.map((sig) => (
            <SignalRow key={sig.id} sig={sig} />
          ))}
        </ul>
      )}
      <Pager
        page={data.page}
        pages={data.pages}
        total={data.total}
        hrefFor={(p) => signalsHref(filters, { page: p })}
      />
    </PanelCard>
  );
}
