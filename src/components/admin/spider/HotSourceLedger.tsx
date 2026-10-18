/**
 * 热榜源台账(M34 批③ 验收反馈:纳入采集计划管理):每日 07:43 一轮的
 * 外部热榜渠道逐源运行态——启停开关(fetch 轮按表过滤)、最近拉取、连败、
 * 今日条数;管理动作仅启停,解析契约/上榜条数上限仍在代码注册表。
 */
import StatusSwitch from "@/components/admin/StatusSwitch";
import { MEDIUM_LABELS } from "@/components/admin/insight/shared";
import type { HotSourceRow } from "@/lib/insight/hot-source";

function hhmm(at: Date | null): string {
  return (
    at?.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }) ?? "—"
  );
}

export default function HotSourceLedger({ rows }: { rows: HotSourceRow[] }): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="border-b border-line px-4 py-3 text-sm font-semibold">
        热榜源台账
        <span className="ml-2 text-[11px] font-normal text-text-3">
          每日 07:43 一轮拉榜(登记表 cron);停用源整源跳过,存量信号照常展示
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-xs text-text-2">
              <th className="px-4 py-2.5 font-medium">信号源</th>
              <th className="px-3 py-2.5 font-medium">介质</th>
              <th className="px-3 py-2.5 font-medium">启用</th>
              <th className="px-3 py-2.5 text-right font-medium">今日条数</th>
              <th className="px-3 py-2.5 font-medium">最近拉取</th>
              <th className="px-4 py-2.5 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.source} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                <td className="px-4 py-2.5">
                  <span className={`text-text-1 ${r.enabled ? "" : "opacity-45"}`}>{r.label}</span>
                  {r.lastError !== null && (
                    <span
                      className="ml-2 truncate align-middle font-mono text-[10px] text-red/80"
                      title={r.lastError}
                    >
                      {r.lastError}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-text-3">{MEDIUM_LABELS[r.medium] ?? r.medium}</td>
                <td className="px-3 py-2.5">
                  <StatusSwitch
                    endpoint={`/api/insight/hot-sources/${r.source}/status`}
                    enabled={r.enabled}
                    name={r.label}
                    disableHint={`停用「${r.label}」后每日拉榜将整源跳过,确定?`}
                  />
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-[12px] text-text-2">
                  {r.todayCount}
                </td>
                <td className="px-3 py-2.5 font-mono text-[11px] text-text-3">
                  {hhmm(r.lastRunAt)}
                </td>
                <td className="px-4 py-2.5">
                  {r.consecutiveFails >= 3 ? (
                    <span className="rounded-sm bg-red/12 px-1.5 py-0.5 font-mono text-[10px] text-red">
                      连败 {r.consecutiveFails}
                    </span>
                  ) : r.consecutiveFails > 0 ? (
                    <span className="rounded-sm bg-amber/12 px-1.5 py-0.5 font-mono text-[10px] text-amber-hi">
                      败 {r.consecutiveFails}
                    </span>
                  ) : (
                    <span className="rounded-sm bg-green/12 px-1.5 py-0.5 font-mono text-[10px] text-green">
                      正常
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-text-3">
                  暂无在役热榜源(代码注册表为空)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
