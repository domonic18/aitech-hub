"use client";

/**
 * 采集计划看板(M34 批③ 验收反馈·问题1,照搬 ai-invest 采集管理):
 * 列表/日历双视图 Segmented 切换 + 分类筛选 chips(色点 pill);列表按凌晨
 * 时间线排布,日历为周网格(行=小时档 03-08,列=周一..周日,任务 chip 落
 * 触发时刻)。常驻 tick(分钟级)不入网格,单列清单在两视图下方。
 */
import { useMemo, useState } from "react";

import {
  DOW_LABELS_CN,
  RESIDENT_REGISTRY,
  SCHEDULE_CATEGORIES,
  type ScheduleCategory,
  type ScheduleEntry,
} from "@/lib/collect/schedules";

type ViewMode = "list" | "calendar";

/** 分类筛选 pill(色点 + 计数;toggle 式多选) */
function CategoryChips({
  active,
  onToggle,
  counts,
}: {
  active: Set<ScheduleCategory>;
  onToggle: (c: ScheduleCategory) => void;
  counts: Record<string, number>;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(Object.keys(SCHEDULE_CATEGORIES) as ScheduleCategory[]).map((c) => {
        const meta = SCHEDULE_CATEGORIES[c];
        const on = active.has(c);
        return (
          <button
            key={c}
            type="button"
            onClick={() => onToggle(c)}
            className={`flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[11px] transition-colors ${
              on ? "text-text-1" : "text-text-3 hover:text-text-2"
            }`}
            style={on ? { background: `${meta.color}29`, color: meta.color } : undefined}
          >
            <i
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: meta.color, opacity: on ? 1 : 0.45 }}
            />
            {meta.label}
            {counts[c] !== undefined && <span className="font-mono opacity-70">{counts[c]}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Chip({ entry }: { entry: ScheduleEntry }): React.ReactElement {
  const color = SCHEDULE_CATEGORIES[entry.category].color;
  return (
    <span
      title={`${entry.parsed.times.join(" / ")} · ${entry.label} — ${entry.desc}`}
      className="flex cursor-default items-center gap-1 truncate rounded-sm px-1.5 py-0.5 text-[11px] leading-4"
      style={{ background: `${color}29`, color }}
    >
      <span className="shrink-0 font-mono">{entry.parsed.times[0]}</span>
      <span className="truncate">{entry.label}</span>
      {entry.parsed.times.length > 1 && (
        <span className="shrink-0 font-mono opacity-70">×{entry.parsed.times.length}</span>
      )}
    </span>
  );
}

/** 周网格日历:行=小时档(自动覆盖在役定时档),列=周一..周日 */
function ScheduleCalendar({ entries }: { entries: ScheduleEntry[] }): React.ReactElement | null {
  const hours = useMemo(() => {
    if (entries.length === 0) return [3];
    const used = entries.map((e) => Number(e.parsed.times[0].slice(0, 2)));
    const lo = Math.min(...used, 3);
    const hi = Math.min(23, Math.max(...used) + 1);
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }, [entries]);
  if (entries.length === 0) {
    return <p className="px-4 py-6 text-center text-xs text-text-3">该分类暂无定时任务</p>;
  }
  const cols = [1, 2, 3, 4, 5, 6, 0]; // 周一..周日
  return (
    <div className="overflow-x-auto px-3 pb-3 pt-1">
      <div className="min-w-[640px]">
        <div
          className="grid gap-1 text-[11px] text-text-3"
          style={{ gridTemplateColumns: "48px repeat(7, minmax(80px, 1fr))" }}
        >
          <span />
          {cols.map((d) => (
            <span key={d} className="px-1 pb-1 text-center">
              {DOW_LABELS_CN[d]}
            </span>
          ))}
          {hours.map((h) => (
            <div key={h} className="contents">
              <span className="pt-1 text-right font-mono text-text-3">
                {String(h).padStart(2, "0")}:00
              </span>
              {cols.map((d) => {
                const cell = entries.filter(
                  (e) =>
                    e.parsed.times.some((t) => Number(t.slice(0, 2)) === h) &&
                    (e.parsed.days === null || e.parsed.days.includes(d)),
                );
                return (
                  <div
                    key={d}
                    className="flex min-h-[34px] flex-col gap-1 rounded-sm bg-panel-2/60 px-1 py-1"
                  >
                    {cell.slice(0, 3).map((e) => (
                      <Chip key={e.key} entry={e} />
                    ))}
                    {cell.length > 3 && (
                      <span
                        className="px-1 font-mono text-[10px] text-text-3"
                        title={cell
                          .slice(3)
                          .map((e) => e.label)
                          .join("、")}
                      >
                        +{cell.length - 3}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 列表视图:时间线行(时刻 + 任务 + 说明 + 计划口径) */
function ScheduleList({ entries }: { entries: ScheduleEntry[] }): React.ReactElement | null {
  if (entries.length === 0) {
    return <p className="px-4 py-6 text-center text-xs text-text-3">该分类暂无定时任务</p>;
  }
  return (
    <div className="px-2 py-1">
      {entries.map((e) => {
        const meta = SCHEDULE_CATEGORIES[e.category];
        return (
          <div
            key={e.key}
            className="grid grid-cols-[72px_130px_1fr_150px] items-center gap-3 rounded-sm px-2 py-2 text-[13px] hover:bg-panel-2"
          >
            <span className="font-mono text-[12px] text-text-1">
              {e.parsed.times.map((t) => t.slice(0, 5)).join(" ")}
            </span>
            <span className="flex items-center gap-1.5 truncate">
              <i
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: meta.color }}
              />
              <span className="truncate text-text-1">{e.label}</span>
            </span>
            <span className="truncate text-xs text-text-3" title={e.desc}>
              {e.desc}
            </span>
            <span className="text-right font-mono text-[11px] text-text-3">
              {e.parsed.days === null
                ? "每日"
                : e.parsed.days.map((d) => DOW_LABELS_CN[d]).join("/")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function ScheduleBoard({
  calendar,
  resident,
}: {
  calendar: ScheduleEntry[];
  resident: ScheduleEntry[];
}): React.ReactElement {
  const [view, setView] = useState<ViewMode>("list");
  const [active, setActive] = useState<Set<ScheduleCategory>>(
    new Set(Object.keys(SCHEDULE_CATEGORIES) as ScheduleCategory[]),
  );
  const filtered = useMemo(
    () => calendar.filter((e) => active.has(e.category)),
    [calendar, active],
  );
  const filteredResident = useMemo(
    () => resident.filter((e) => active.has(e.category)),
    [resident, active],
  );
  const toggle = (c: ScheduleCategory) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  const counts: Record<string, number> = {};
  for (const e of calendar) counts[e.category] = (counts[e.category] ?? 0) + 1;

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
          <CategoryChips active={active} onToggle={toggle} counts={counts} />
        </div>
        {view === "list" ? (
          <ScheduleList entries={filtered} />
        ) : (
          <ScheduleCalendar entries={filtered} />
        )}
      </div>

      {/* 常驻 tick(分钟级循环,不入小时网格)+ 高频 cron 对账档 */}
      <div className="rounded-md border border-line bg-panel">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold">
          常驻任务
          <span className="ml-2 text-[11px] font-normal text-text-3">
            分钟级循环与高频对账档,不入日历网格
          </span>
        </div>
        <div className="grid gap-x-4 px-2 py-1 lg:grid-cols-2">
          {filteredResident.map((e) => (
            <div
              key={e.key}
              className="flex items-center gap-2.5 rounded-sm px-2 py-1.5 hover:bg-panel-2"
            >
              <span className="w-16 shrink-0 rounded-sm bg-accent-dim px-1 py-0.5 text-center font-mono text-[10px] text-accent">
                {e.parsed.times.length}次/时
              </span>
              <span className="shrink-0 text-[12px] text-text-1">{e.label}</span>
              <span className="truncate text-[11px] text-text-3" title={e.desc}>
                {e.desc}
              </span>
            </div>
          ))}
          {RESIDENT_REGISTRY.filter((r) => active.has(r.category)).map((r) => (
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
    </div>
  );
}
