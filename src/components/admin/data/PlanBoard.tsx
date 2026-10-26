"use client";

/**
 * F21 采集计划板:六业务分组列表(组头可折叠,列 任务|节奏|下次执行(未来
 * 3 次)|状态|最近运行|操作)+ 日历视图切 PlanCalendar(F22)+ 常驻 tick 清单
 * (分钟级循环,不入日历网格)。文案服务端预格式化,客户端零时刻推导。
 */
import Link from "next/link";
import { useMemo, useState } from "react";

import PlanCalendar from "@/components/admin/data/PlanCalendar";
import {
  PLAN_GROUPS,
  type PlanCalEntry,
  type PlanGroup,
  type PlanRow,
} from "@/lib/collect/plan-rows-types";
import { RESIDENT_REGISTRY } from "@/lib/collect/schedules";

const GROUP_ORDER = Object.keys(PLAN_GROUPS) as PlanGroup[];

type ViewMode = "list" | "calendar";

function StatusCell({ row }: { row: PlanRow }): React.ReactElement {
  if (row.running) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-amber">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />
        采集中
      </span>
    );
  }
  return row.enabled ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-green">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-green" />
      启用
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-3">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-line" />
      暂停
    </span>
  );
}

function LastRunCell({ row }: { row: PlanRow }): React.ReactElement {
  if (row.lastRun === null) return <span className="text-text-3">—</span>;
  return <span className={row.lastRun.ok ? "text-text-2" : "text-red"}>{row.lastRun.text}</span>;
}

function OpsCell({ row }: { row: PlanRow }): React.ReactElement | null {
  const items: [string, string][] = [];
  if (row.links.edit !== undefined) items.push(["编辑", row.links.edit]);
  if (row.links.logs !== undefined) items.push(["日志", row.links.logs]);
  if (row.links.live !== undefined) items.push(["实时", row.links.live]);
  if (items.length === 0) return null;
  return (
    <span className="text-xs">
      {items.map(([label, href], i) => (
        <span key={label}>
          {i > 0 && <span className="text-text-3"> · </span>}
          <Link href={href} className="text-text-2 hover:text-accent">
            {label}
          </Link>
        </span>
      ))}
    </span>
  );
}

const LIST_COLS =
  "grid grid-cols-[minmax(150px,1.2fr)_100px_minmax(190px,1.3fr)_76px_180px_130px] items-center gap-3";

function PlanGroupSection({
  group,
  rows,
  collapsed,
  onToggle,
}: {
  group: PlanGroup;
  rows: PlanRow[];
  collapsed: boolean;
  onToggle: (g: PlanGroup) => void;
}): React.ReactElement | null {
  const meta = PLAN_GROUPS[group];
  if (rows.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-md border border-line bg-panel">
      <button
        type="button"
        onClick={() => onToggle(group)}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left text-[13px] font-semibold hover:bg-panel-2"
      >
        <span className="text-text-3">{collapsed ? "▸" : "▾"}</span>
        <i
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: meta.color }}
        />
        {meta.label}
        <span className="font-mono text-[11px] font-normal text-text-3">{rows.length}</span>
      </button>
      {!collapsed && (
        <div className="border-t border-line">
          <div className={`${LIST_COLS} px-4 py-2 text-[11px] text-text-3`}>
            <span>任务</span>
            <span>节奏</span>
            <span>下次执行(未来 3 次)</span>
            <span>状态</span>
            <span>最近运行</span>
            <span className="text-right">操作</span>
          </div>
          {rows.map((r) => (
            <div
              key={r.key}
              className={`${LIST_COLS} border-t border-line px-4 py-2.5 text-[13px] hover:bg-panel-2 ${
                r.enabled ? "" : "opacity-60"
              }`}
            >
              <span className="flex items-center gap-1.5 truncate">
                <i
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: meta.color, opacity: r.enabled ? 1 : 0.45 }}
                />
                <span className="truncate text-text-1">{r.name}</span>
              </span>
              <span className="truncate text-xs text-text-2">{r.cadence}</span>
              <span className="truncate font-mono text-[11px] text-text-2" title={r.nextText}>
                {r.nextText}
              </span>
              <StatusCell row={r} />
              <LastRunCell row={r} />
              <span className="text-right">
                <OpsCell row={r} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PlanBoard({
  rows,
  calEntries,
}: {
  rows: PlanRow[];
  calEntries: PlanCalEntry[];
}): React.ReactElement {
  const [view, setView] = useState<ViewMode>("list");
  const [collapsed, setCollapsed] = useState<Set<PlanGroup>>(new Set());
  const toggle = (g: PlanGroup): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  const byGroup = useMemo(() => {
    const map = new Map<PlanGroup, PlanRow[]>();
    for (const g of GROUP_ORDER) map.set(g, []);
    for (const r of rows) map.get(r.group)?.push(r);
    return map;
  }, [rows]);
  const enabledCount = rows.filter((r) => r.enabled).length;
  const runningCount = rows.filter((r) => r.running).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
          <div className="flex rounded-sm border border-line p-0.5">
            {(["list", "calendar"] as ViewMode[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-sm px-2.5 py-0.5 text-xs ${
                  view === v ? "bg-accent-dim text-accent" : "text-text-3 hover:text-text-1"
                }`}
              >
                {v === "list" ? "列表" : "日历"}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-text-3">
            {view === "list"
              ? "按业务分类分组,展开查看任务明细;切换日历视图见下一板"
              : "按周总览定时分布(通用周,不绑定具体日期)· 仅表达计划(cron 推导),执行状态见 运行 · 采集日志"}
          </span>
        </div>
        {view === "list" ? (
          <div className="flex flex-col gap-3 p-3">
            {GROUP_ORDER.map((g) => (
              <PlanGroupSection
                key={g}
                group={g}
                rows={byGroup.get(g) ?? []}
                collapsed={collapsed.has(g)}
                onToggle={toggle}
              />
            ))}
          </div>
        ) : (
          <PlanCalendar entries={calEntries} />
        )}
      </div>

      {/* 常驻 tick(分钟级循环,不入日历网格;全部属 维护 域基础设施) */}
      <div className="rounded-md border border-line bg-panel">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold">
          常驻任务
          <span className="ml-2 text-[11px] font-normal text-text-3">
            分钟级循环与高频对账档,不入日历网格
          </span>
        </div>
        <div className="grid gap-x-4 px-2 py-1 lg:grid-cols-2">
          {RESIDENT_REGISTRY.map((r) => (
            <div
              key={r.key}
              className="flex items-center gap-2.5 rounded-sm px-2 py-1.5 hover:bg-panel-2"
            >
              <span className="w-16 shrink-0 rounded-sm bg-panel-2 px-1 py-0.5 text-center font-mono text-[10px] text-text-2">
                {r.cadence}
              </span>
              <span className="shrink-0 text-[12px] text-text-1">{r.label}</span>
              <span className="truncate text-[11px] text-text-3" title={r.desc}>
                {r.desc}
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="font-mono text-[11px] text-text-3">
        共 {rows.length} 项计划 · 启用 {enabledCount}
        {runningCount > 0 && ` · 采集中 ${runningCount}`}
      </p>
    </div>
  );
}
