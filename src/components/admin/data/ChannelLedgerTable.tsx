"use client";

/**
 * F17 采集渠道统一台账(客户端):筛选 chips + 分组分节表(组头可折叠,列
 * 渠道|备注|自动调度|健康|最近运行|手动触发)。分组口径与采集计划板同形态
 * (CHANNEL_GROUPS 组序 + 色点);行渲染与动作分发在 ChannelLedgerRow(≤350
 * 行拆分,2026-10-30 分组/备注改造)。
 */
import { useMemo, useState } from "react";

import ChannelLedgerRowView from "@/components/admin/data/ChannelLedgerRow";
import {
  CHANNEL_GROUP_ORDER,
  CHANNEL_GROUP_TABS,
  CHANNEL_GROUPS,
  type ChannelGroup,
  type ChannelLedgerRow,
} from "@/lib/collect/channel-ledger-types";

const COLS = 6;

export default function ChannelLedgerTable({ rows }: { rows: ChannelLedgerRow[] }) {
  const [filter, setFilter] = useState<ChannelGroup | "all">("all");
  const [collapsed, setCollapsed] = useState<Set<ChannelGroup>>(new Set());

  const counts = new Map<ChannelGroup | "all", number>([["all", rows.length]]);
  for (const r of rows) counts.set(r.group, (counts.get(r.group) ?? 0) + 1);

  const visible = filter === "all" ? rows : rows.filter((r) => r.group === filter);
  const sections = useMemo(() => {
    const byGroup = new Map<ChannelGroup, ChannelLedgerRow[]>();
    for (const r of visible) {
      const list = byGroup.get(r.group);
      if (list === undefined) byGroup.set(r.group, [r]);
      else list.push(r);
    }
    return CHANNEL_GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({
      group: g,
      rows: byGroup.get(g) ?? [],
    }));
  }, [visible]);

  const enabledCount = rows.filter((r) => r.enabled).length;

  const toggle = (g: ChannelGroup): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {CHANNEL_GROUP_TABS.map(([group, label]) => (
          <button
            key={group}
            type="button"
            onClick={() => setFilter(group)}
            className={`cursor-pointer rounded-full px-3 py-1 text-xs transition-colors ${
              filter === group
                ? "bg-accent-dim font-semibold text-accent"
                : "bg-panel-2 text-text-2 hover:bg-panel hover:text-text-1"
            }`}
          >
            {label} {counts.get(group) ?? 0}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-xs text-text-3">
              <th className="px-4 py-2.5 font-medium">渠道</th>
              <th className="px-3 py-2.5 font-medium">备注</th>
              <th className="px-3 py-2.5 font-medium">自动调度</th>
              <th className="px-3 py-2.5 font-medium">健康</th>
              <th className="px-3 py-2.5 font-medium">最近运行</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">手动触发</th>
            </tr>
          </thead>
          {sections.map(({ group, rows: groupRows }) => {
            const meta = CHANNEL_GROUPS[group];
            const isCollapsed = collapsed.has(group);
            return (
              <tbody key={group}>
                <tr className="border-b border-line bg-panel-2/60">
                  <td colSpan={COLS} className="p-0">
                    <button
                      type="button"
                      onClick={() => toggle(group)}
                      className="flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-left text-[13px] font-semibold hover:bg-panel-2"
                    >
                      <span className="text-text-3">{isCollapsed ? "▸" : "▾"}</span>
                      <i
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ background: meta.color }}
                      />
                      {meta.label}
                      <span className="font-mono text-[11px] font-normal text-text-3">
                        {groupRows.length}
                      </span>
                    </button>
                  </td>
                </tr>
                {!isCollapsed && groupRows.map((r) => <ChannelLedgerRowView key={r.key} row={r} />)}
              </tbody>
            );
          })}
          {visible.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={COLS} className="px-4 py-10 text-center text-xs text-text-3">
                  该分组暂无渠道
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-text-3">
        说明:手动触发 = 入队即返回,进度见 运行 · 实时采集;运行中重复触发自动去重;试拉 =
        单次试跑不入库,仅验连通与解析。备注可在「编辑」里维护。
      </p>
      <p className="font-mono text-[11px] text-text-3">
        共 {rows.length} 个渠道 · 已启用 {enabledCount}
      </p>
    </div>
  );
}
