"use client";

/**
 * F22 采集计划日历:日时间线 / 周网格(通用周,08:00-20:00 时间窗)/ 月密度
 * 三视图 + 仅启用 switch + 六类 legend(可点筛选)。条目由服务端预推导
 * (PlanCalEntry):周窗外任务进 footnote;循环型(间隔/hourly)不展开时刻;
 * 月视图按日均触发次数做密度热格。
 */
import { useMemo, useState } from "react";

import {
  CAL_WINDOW,
  PLAN_GROUPS,
  type PlanCalEntry,
  type PlanGroup,
} from "@/lib/collect/plan-rows-types";
import { DOW_LABELS_CN } from "@/lib/collect/schedules";
import { DAY_MS } from "@/lib/datetime";

type Period = "day" | "week" | "month";

const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 周一..周日

/** 北京墙钟星期(PG dow 口径) */
function cnDow(d: Date): number {
  return new Date(d.getTime() + 8 * 3_600_000).getUTCDay();
}

function Chip({ entry }: { entry: PlanCalEntry }): React.ReactElement {
  const color = PLAN_GROUPS[entry.group].color;
  return (
    <span
      title={`${entry.label} · ${entry.cadence}`}
      className="flex cursor-default items-center gap-1 truncate rounded-sm px-1.5 py-0.5 text-[11px] leading-4"
      style={{ background: `${color}29`, color }}
    >
      <span className="truncate">{entry.label}</span>
      <span className="shrink-0 font-mono opacity-70">{entry.cadence}</span>
    </span>
  );
}

function Legend({
  active,
  onToggle,
}: {
  active: Set<PlanGroup>;
  onToggle: (g: PlanGroup) => void;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-text-3">分类:</span>
      {(Object.keys(PLAN_GROUPS) as PlanGroup[]).map((g) => {
        const meta = PLAN_GROUPS[g];
        const on = active.has(g);
        return (
          <button
            key={g}
            type="button"
            onClick={() => onToggle(g)}
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
          </button>
        );
      })}
    </div>
  );
}

/** 日视图:今日时间线——循环型(间隔/hourly)在前,定时档按首时刻排序 */
function DayView({ entries }: { entries: PlanCalEntry[] }): React.ReactElement | null {
  const today = cnDow(new Date());
  const active = entries.filter((e) => e.days === null || e.days.includes(today));
  const looping = active.filter((e) => e.times === null);
  const timed = active
    .filter((e) => e.times !== null)
    .sort((a, b) => {
      const ta = a.times?.[0] ?? "99";
      const tb = b.times?.[0] ?? "99";
      return ta.localeCompare(tb);
    });
  if (active.length === 0) {
    return <p className="px-4 py-6 text-center text-xs text-text-3">今日无定时任务</p>;
  }
  return (
    <div className="px-2 py-1">
      {[...looping, ...timed].map((e) => {
        const meta = PLAN_GROUPS[e.group];
        return (
          <div
            key={e.key}
            className="grid grid-cols-[190px_150px_1fr] items-center gap-3 rounded-sm px-2 py-2 text-[13px] hover:bg-panel-2"
          >
            <span className="truncate font-mono text-[12px] text-text-1">
              {e.times === null ? (
                <span className="rounded-sm bg-accent-dim px-1.5 py-0.5 font-sans text-[10px] text-accent">
                  循环
                </span>
              ) : (
                e.times.join(" / ")
              )}
            </span>
            <span className="flex items-center gap-1.5 truncate">
              <i
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: meta.color }}
              />
              <span className="truncate text-text-1">{e.label}</span>
            </span>
            <span className="truncate text-xs text-text-3">{e.cadence}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 周视图:通用周网格(行=小时档 08-20,列=周一..周日),窗外任务进 footnote */
function WeekView({ entries }: { entries: PlanCalEntry[] }): React.ReactElement {
  const hours = Array.from(
    { length: CAL_WINDOW.hi - CAL_WINDOW.lo + 1 },
    (_, i) => CAL_WINDOW.lo + i,
  );
  const foot = entries.filter((e) => e.weekHour === null);
  return (
    <div>
      <div className="overflow-x-auto px-3 pb-2 pt-1">
        <div className="min-w-[640px]">
          <div
            className="grid gap-1 text-[11px] text-text-3"
            style={{ gridTemplateColumns: "48px repeat(7, minmax(80px, 1fr))" }}
          >
            <span />
            {DOW_ORDER.map((d) => (
              <span key={d} className="px-1 pb-1 text-center">
                {DOW_LABELS_CN[d]}
              </span>
            ))}
            {hours.map((h) => (
              <div key={h} className="contents">
                <span className="pt-1 text-right font-mono text-text-3">
                  {String(h).padStart(2, "0")}:00
                </span>
                {DOW_ORDER.map((d) => {
                  const cell = entries.filter(
                    (e) => e.weekHour === h && (e.days === null || e.days.includes(d)),
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
      <p className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-text-3">
        {foot.length > 0 && (
          <>
            另有(时间窗外):
            {foot.map((e) => `${e.label} ${e.cadence}`).join(" · ")}
            {" · "}
          </>
        )}
        切「日 / 月」查看单日明细与整月密度
      </p>
    </div>
  );
}

/** 月视图:自本周一起 35 天密度热格(日均触发次数,含循环型) */
function MonthView({ entries }: { entries: PlanCalEntry[] }): React.ReactElement | null {
  const cells = useMemo(() => {
    const now = new Date();
    const monday = new Date(now.getTime() - ((cnDow(now) + 6) % 7) * DAY_MS);
    const mondayCn = new Date(
      `${monday.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })}T00:00:00+08:00`,
    );
    return Array.from({ length: 35 }, (_, i) => {
      const day = new Date(mondayCn.getTime() + i * DAY_MS);
      const dow = cnDow(day);
      const hits = entries.filter((e) => e.days === null || e.days.includes(dow));
      const count = hits.reduce((acc, e) => acc + e.firesPerDay, 0);
      return { day, dow, count, labels: hits.map((e) => e.label) };
    });
  }, [entries]);
  const max = Math.max(1, ...cells.map((c) => c.count));
  return (
    <div className="overflow-x-auto px-3 pb-3 pt-1">
      <div
        className="grid min-w-[640px] gap-1 text-[11px] text-text-3"
        style={{ gridTemplateColumns: "repeat(7, minmax(80px, 1fr))" }}
      >
        {DOW_ORDER.map((d) => (
          <span key={d} className="px-1 pb-1 text-center">
            {DOW_LABELS_CN[d]}
          </span>
        ))}
        {cells.map(({ day, count, labels }, i) => (
          <div
            key={i}
            title={`${day.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })} · 约 ${count} 次\n${labels.join("、")}`}
            className="flex min-h-[52px] flex-col justify-between rounded-sm px-1.5 py-1"
            style={{
              background: count > 0 ? `rgba(94, 106, 210, ${(count / max) * 0.22})` : undefined,
            }}
          >
            <span className={i < 7 ? "text-text-2" : "text-text-3"}>
              {day.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }).slice(8)}
            </span>
            {count > 0 && <span className="font-mono text-[10px] text-text-2">~{count} 次</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PlanCalendar({ entries }: { entries: PlanCalEntry[] }): React.ReactElement {
  const [period, setPeriod] = useState<Period>("week");
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [active, setActive] = useState<Set<PlanGroup>>(
    new Set(Object.keys(PLAN_GROUPS) as PlanGroup[]),
  );
  const filtered = useMemo(
    () => entries.filter((e) => active.has(e.group) && (!enabledOnly || e.enabled)),
    [entries, active, enabledOnly],
  );
  const toggle = (g: PlanGroup): void =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
        <div className="flex rounded-sm border border-line p-0.5">
          {(["day", "week", "month"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded-sm px-2.5 py-0.5 text-xs ${
                period === p ? "bg-accent-dim text-accent" : "text-text-3 hover:text-text-1"
              }`}
            >
              {p === "day" ? "日" : p === "week" ? "周" : "月"}
            </button>
          ))}
        </div>
        <Legend active={active} onToggle={toggle} />
        <button
          type="button"
          onClick={() => setEnabledOnly((v) => !v)}
          className={`ml-auto flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[11px] transition-colors ${
            enabledOnly ? "bg-accent-dim text-accent" : "text-text-3 hover:text-text-2"
          }`}
        >
          <i
            className={`inline-block h-1.5 w-1.5 rounded-full ${enabledOnly ? "bg-accent" : "bg-line"}`}
          />
          仅启用
        </button>
      </div>
      {period === "day" ? (
        <DayView entries={filtered} />
      ) : period === "week" ? (
        <WeekView entries={filtered} />
      ) : (
        <MonthView entries={filtered} />
      )}
    </div>
  );
}
