/**
 * 洞察中心·实体(M59 批B → M60 实体层):按顶层品牌分区的实体视图——品牌 ›
 * 产品线 › 实体,同名不同写法的键折叠在同一品牌下(不再 qwen-mt-turbo /
 * qwen3-embedding 各占一行互不相干)。筛选(厂商/类型/时间窗/关键词)chip 走
 * URL,与洞察各页同一套 chip 语法;关键词同时匹配展示名/规范键/别名。
 * 口径:只聚合 entity_event(厂商抽取链);社区/热榜信号暂无实体挂接。
 */
import Link from "next/link";

import {
  ENTITIES_PATH,
  entityHref,
  entityListHref,
  type EntityFilters,
  type EntityPage,
  type EntityRow,
  type EntitySection,
} from "@/lib/insight/entities-admin";
import {
  ENTITY_TYPES,
  ENTITY_TYPE_LABELS,
  EVENT_TYPE_LABELS,
  type EntityEventType,
} from "@/lib/insight/vendor/constants";
import { VENDOR_DEFS } from "@/lib/insight/vendor/registry";

import Pager from "./Pager";
import { PanelCard } from "./PanelCard";
import { chipOff, chipOn, formatTime } from "./shared";

const WINDOW_OPTIONS = [7, 30, 90] as const;

const COL_COUNT = 7;

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

/** 实体行:展示名(链接)+ 规范键;产品线仅在非品牌层出现 */
function EntityRowView({ row }: { row: EntityRow }): React.ReactElement {
  return (
    <tr className="border-b border-line last:border-b-0 hover:bg-panel-2">
      <td className="px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <Link href={entityHref(row.key)} className="text-[12.5px] text-text-1 hover:text-accent">
            {row.displayName}
          </Link>
          <span className="truncate font-mono text-[10.5px] text-text-3" title={row.key}>
            {row.key}
          </span>
        </div>
      </td>
      <td className="px-2 py-2">
        <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[10.5px] whitespace-nowrap text-text-2">
          {row.entityType === ""
            ? "—"
            : (ENTITY_TYPE_LABELS[row.entityType as keyof typeof ENTITY_TYPE_LABELS] ??
              row.entityType)}
        </span>
      </td>
      <td className="px-2 py-2 font-mono text-[11px] whitespace-nowrap text-text-3">
        {row.parentKey === null || row.parentKey === row.rootKey ? "—" : row.parentName}
      </td>
      <td className="px-2 py-2 text-right font-mono text-[11px] text-text-3">
        {row.aliasCount > 0 ? row.aliasCount : "—"}
      </td>
      <td className="px-2 py-2 text-right font-mono text-[11px] text-text-2">{row.eventCount}</td>
      <td className="px-2 py-2">
        <div className="flex items-baseline gap-2">
          {row.latestEventType !== "" && (
            <span className="shrink-0 rounded-sm bg-accent-dim px-1.5 py-0.5 font-mono text-[10.5px] whitespace-nowrap text-accent">
              {EVENT_TYPE_LABELS[row.latestEventType as EntityEventType] ?? row.latestEventType}
            </span>
          )}
          {row.latestUrl === "" ? (
            <span className="min-w-0 truncate text-text-2">{row.latestTitle}</span>
          ) : (
            <a
              href={row.latestUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 truncate text-text-1 hover:text-accent"
              title={row.latestTitle}
            >
              {row.latestTitle}
            </a>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-right font-mono text-[11px] whitespace-nowrap text-text-3">
        {formatTime(row.lastAt)}
      </td>
    </tr>
  );
}

/** 品牌分区头:品牌名 + 规范键 + 区内事件合计 */
function SectionHeader({ section }: { section: EntitySection }): React.ReactElement {
  return (
    <tr className="border-b border-line bg-panel-2/60">
      <td colSpan={COL_COUNT} className="px-3 py-1.5">
        <span className="flex items-baseline gap-2">
          <Link
            href={entityHref(section.rootKey)}
            className="text-[12.5px] font-medium text-text-1 hover:text-accent"
          >
            {section.rootName}
          </Link>
          <span className="font-mono text-[10.5px] text-text-3">{section.rootKey}</span>
          <span className="font-mono text-[10.5px] text-text-3">
            {section.rows.length} 个实体 · 事件 {section.eventCount}
          </span>
        </span>
      </td>
    </tr>
  );
}

export default function EntitiesBoard({
  data,
  filters,
}: {
  data: EntityPage;
  filters: EntityFilters;
}): React.ReactElement {
  /** 任何筛选切换都回第 1 页 */
  const swap = (overrides: Partial<EntityFilters>): string =>
    entityListHref(filters, { ...overrides, page: 1 });

  return (
    <PanelCard
      title="实体"
      hint="按品牌 › 产品线 › 实体分区的厂商事件 · 数据来自官方发布抽取,社区/热榜信号暂无实体挂接"
      extra={
        <span className="flex items-center gap-3 font-mono text-[11px] text-text-3">
          <span>共 {data.total.toLocaleString()} 个实体</span>
          {data.unresolved > 0 && (
            <span className="text-text-2" title="历史事件尚未挂到实体,回填后自动归位">
              待归位 {data.unresolved.toLocaleString()} 条事件
            </span>
          )}
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 pb-2">
        <Chip on={filters.vendor === undefined} href={swap({ vendor: undefined })}>
          全部厂商
        </Chip>
        {VENDOR_DEFS.map((d) => (
          <Chip key={d.key} on={filters.vendor === d.key} href={swap({ vendor: d.key })}>
            {d.vendorName}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-2">
        <Chip on={filters.entityType === undefined} href={swap({ entityType: undefined })}>
          全部类型
        </Chip>
        {ENTITY_TYPES.map((t) => (
          <Chip key={t} on={filters.entityType === t} href={swap({ entityType: t })}>
            {ENTITY_TYPE_LABELS[t]}
          </Chip>
        ))}
        <span className="ml-1 text-[10px] text-text-3">时间</span>
        <Chip on={filters.windowDays === undefined} href={swap({ windowDays: undefined })}>
          全部
        </Chip>
        {WINDOW_OPTIONS.map((n) => (
          <Chip key={n} on={filters.windowDays === n} href={swap({ windowDays: n })}>
            近 {n} 天
          </Chip>
        ))}
        <form method="GET" action={ENTITIES_PATH} className="ml-auto flex items-center gap-1.5">
          {filters.vendor !== undefined && (
            <input type="hidden" name="vendor" value={filters.vendor} />
          )}
          {filters.entityType !== undefined && (
            <input type="hidden" name="entityType" value={filters.entityType} />
          )}
          {filters.windowDays !== undefined && (
            <input type="hidden" name="window" value={String(filters.windowDays)} />
          )}
          <input
            type="search"
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="实体名 / 别名"
            aria-label="实体关键词"
            maxLength={40}
            className="w-36 rounded-sm border border-line bg-panel px-1.5 py-0.5 font-mono text-[11px] text-text-2"
          />
          <button
            type="submit"
            className="cursor-pointer rounded-sm border border-line bg-panel px-2 py-0.5 text-[11px] text-text-2 hover:border-line-hover hover:text-text-1"
          >
            搜索
          </button>
          {filters.q !== undefined && (
            <Link
              href={swap({ q: undefined })}
              scroll={false}
              className="text-[11px] text-text-3 hover:text-accent"
            >
              清除
            </Link>
          )}
        </form>
      </div>

      {data.sections.length === 0 ? (
        <p className="px-3 py-8 text-center text-[12.5px] text-text-3">
          暂无实体——厂商官网采集后由 LLM 抽取事件生成;渠道状态见 数据中心·源管理·采集渠道。
        </p>
      ) : (
        <table className="w-full table-fixed text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-[11px] text-text-3">
              <th className="w-[26%] px-3 py-1.5 font-normal">实体</th>
              <th className="w-16 px-2 py-1.5 font-normal">类型</th>
              <th className="w-[15%] px-2 py-1.5 font-normal">产品线</th>
              <th className="w-12 px-2 py-1.5 text-right font-normal">别名</th>
              <th className="w-12 px-2 py-1.5 text-right font-normal">事件</th>
              <th className="px-2 py-1.5 font-normal">最近事件</th>
              <th className="w-24 px-3 py-1.5 text-right font-normal">最近时间</th>
            </tr>
          </thead>
          <tbody>
            {data.sections.map((section) => (
              <SectionRows key={section.rootKey} section={section} />
            ))}
          </tbody>
        </table>
      )}
      <Pager
        page={data.page}
        pages={data.pages}
        total={data.total}
        hrefFor={(p) => entityListHref(filters, { page: p })}
      />
    </PanelCard>
  );
}

function SectionRows({ section }: { section: EntitySection }): React.ReactElement {
  return (
    <>
      <SectionHeader section={section} />
      {section.rows.map((row) => (
        <EntityRowView key={row.key} row={row} />
      ))}
    </>
  );
}
