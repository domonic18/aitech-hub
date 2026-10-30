/**
 * 洞察中心·事件(M58 批②,data-expansion-plan §5.3):厂商官方发布的
 * 结构化事件台账——按厂商/类型筛选,标题外链原文,摘要即抽取产物。
 * 只读服务端组件;筛选 chip 走 URL(与洞察各页同一套 chip 语法)。
 */
import Link from "next/link";

import {
  EVENT_DEFAULT_LIMIT,
  EVENT_TYPE_OPTIONS,
  VENDOR_LABELS,
  type EntityEventFilters,
  type EntityEventRow,
} from "@/lib/insight/events-admin";
import { entityHref } from "@/lib/insight/entities-admin";
import {
  EVENT_TYPE_LABELS,
  ENTITY_TYPE_LABELS,
  type EntityEventType,
} from "@/lib/insight/vendor/constants";
import { VENDOR_DEFS } from "@/lib/insight/vendor/registry";

import { PanelCard } from "./PanelCard";
import { chipOff, chipOn, formatTime } from "./shared";

const BASE = "/admin/insight/events/";

function href(filters: EntityEventFilters, overrides: Partial<EntityEventFilters>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...filters, ...overrides })) {
    if (v === undefined || v === "" || v === null) continue;
    if (k === "limit" && v === EVENT_DEFAULT_LIMIT) continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return `${BASE}${qs ? `?${qs}` : ""}`;
}

function Chip({
  on,
  children,
  filters,
  overrides,
}: {
  on: boolean;
  children: React.ReactNode;
  filters: EntityEventFilters;
  overrides: Partial<EntityEventFilters>;
}): React.ReactElement {
  return (
    <Link
      href={href(filters, overrides)}
      className={on ? chipOn : chipOff}
      aria-current={on || undefined}
    >
      {children}
    </Link>
  );
}

export default function EventsBoard({
  rows,
  filters,
}: {
  rows: EntityEventRow[];
  filters: EntityEventFilters;
}): React.ReactElement {
  return (
    <PanelCard
      title="厂商事件"
      hint="官方发布经 LLM 抽取的结构化事件;标题外链原文,按事件发生时间倒序"
      extra={<span className="font-mono text-[11px] text-text-3">近 {rows.length} 条</span>}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 pb-2">
        <Chip on={filters.vendor === undefined} filters={filters} overrides={{ vendor: undefined }}>
          全部厂商
        </Chip>
        {VENDOR_DEFS.map((d) => (
          <Chip
            key={d.key}
            on={filters.vendor === d.key}
            filters={filters}
            overrides={{ vendor: d.key }}
          >
            {d.vendorName}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-2">
        <Chip
          on={filters.eventType === undefined}
          filters={filters}
          overrides={{ eventType: undefined }}
        >
          全部类型
        </Chip>
        {EVENT_TYPE_OPTIONS.map((t) => (
          <Chip key={t} on={filters.eventType === t} filters={filters} overrides={{ eventType: t }}>
            {EVENT_TYPE_LABELS[t]}
          </Chip>
        ))}
        {/* 同 SignalsBoard:窄屏整条独占一行并允许换行,防两个日期框撑破面板 */}
        <form
          method="GET"
          action={BASE}
          className="ml-auto flex w-full flex-wrap items-center gap-1.5 sm:w-auto"
        >
          {filters.vendor !== undefined && (
            <input type="hidden" name="vendor" value={filters.vendor} />
          )}
          {filters.eventType !== undefined && (
            <input type="hidden" name="eventType" value={filters.eventType} />
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
              href={href(filters, { from: undefined, to: undefined })}
              scroll={false}
              className="text-[11px] text-text-3 hover:text-accent"
            >
              清除
            </Link>
          )}
        </form>
      </div>

      {rows.length === 0 ? (
        <p className="px-3 py-8 text-center text-[13px] text-text-3">
          暂无事件——渠道首次采集后由抽取任务生成;渠道状态见 数据中心·源管理·采集渠道。
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li
              key={r.dedupeKey}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-3 py-2.5"
            >
              <span className="w-[92px] shrink-0 font-mono text-[11px] text-text-3">
                {formatTime(r.occurredAt)}
              </span>
              <span className="shrink-0 rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
                {VENDOR_LABELS[r.vendor] ?? r.vendor}
              </span>
              <span
                className="shrink-0 rounded-sm bg-accent-dim px-1.5 py-0.5 font-mono text-[11px] text-accent"
                title={`实体类型:${ENTITY_TYPE_LABELS[r.entityType as keyof typeof ENTITY_TYPE_LABELS] ?? r.entityType}`}
              >
                {EVENT_TYPE_LABELS[r.eventType as EntityEventType] ?? r.eventType}
              </span>
              {/* 窄屏:时间 92 + 厂商 + 类型 + 实体键已占满首行,标题 flex-1
                  会被压成两三字一列竖排(2026-10-30 移动端验收)。标题与摘要
                  各独占一行(order 1/2),sm 起复原为同行 + 摘要缩进 */}
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="order-1 min-w-0 w-full text-[13px] font-medium hover:text-accent sm:order-none sm:w-auto sm:flex-1"
              >
                {r.title}
              </a>
              <Link
                href={entityHref(r.entityKey)}
                className="inline-block max-w-[46%] shrink-0 truncate font-mono text-[11px] text-text-3 hover:text-accent sm:max-w-none"
                title="查看该实体的全部事件与关联信号"
              >
                {r.entityKey}
              </Link>
              {r.summary !== null && r.summary !== "" && (
                <p className="order-2 w-full text-[12px] leading-5 text-text-2 sm:order-none sm:pl-[92px]">
                  {r.summary}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}
