"use client";

/**
 * 牌价采集源健康度卡(M74 批C2)。
 *
 * 采集是异步的(worker 定时跑),源挂了只表现为「价格不更新」,运营只能翻日志。
 * 这里把每源的四件事摆到台面:健康状态与连败、最近/下次采集、产出行分布
 * (待终审/已上架/待复核)、最近一次采集快照的结论(解析状态 + 错误原文)。
 *
 * 口径:「待复核」= 采集失败时整源打的标(与「待终审」pending 是两回事)。
 */
import type { PricingSourceHealth } from "@/lib/pricing/health";

const STATUS_LABELS: Record<string, string> = {
  healthy: "正常",
  degraded: "降级",
  error: "异常",
};

const PARSE_LABELS: Record<string, string> = {
  pending: "待解析",
  success: "成功",
  failed: "失败",
  empty: "空结果",
};

function fmtTime(d: Date | null): string {
  if (d === null) return "—";
  return d.toISOString().slice(5, 16).replace("T", " ");
}

export function SourceHealth({ sources }: { sources: PricingSourceHealth[] }): React.ReactElement {
  if (sources.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-xs text-text-3">
        没有牌价采集源(worker 启动时会按注册表幂等种入)
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-panel">
      <table className="w-full min-w-[820px] text-left text-xs">
        <thead>
          <tr className="border-b border-line bg-panel-2 text-[11px] text-text-3">
            <th className="px-3 py-2 font-medium">源</th>
            <th className="px-3 py-2 font-medium">状态</th>
            <th className="px-3 py-2 font-medium">最近 / 下次采集</th>
            <th className="px-3 py-2 font-medium">周期</th>
            <th className="px-3 py-2 font-medium">产出(待审/上架/待复核)</th>
            <th className="px-3 py-2 font-medium">最近一次采集</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.key} className="border-b border-line/60 last:border-b-0">
              <td className="px-3 py-2">
                <div className="text-text-1">{s.label}</div>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10.5px] text-blue hover:text-blue/80"
                >
                  源页↗
                </a>
                {!s.enabled && <span className="ml-1.5 text-[10.5px] text-amber">已停用</span>}
              </td>
              <td className="px-3 py-2">
                <span
                  className={
                    s.status === "error"
                      ? "text-red"
                      : s.status === "degraded"
                        ? "text-amber"
                        : "text-green"
                  }
                >
                  {STATUS_LABELS[s.status] ?? s.status}
                </span>
                {s.consecutiveFails > 0 && (
                  <span className="ml-1 font-mono text-[10.5px] text-text-3">
                    连败 {s.consecutiveFails}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 font-mono text-[11px] text-text-2">
                {fmtTime(s.lastRunAt)}
                <span className="mx-1 text-text-3">/</span>
                {fmtTime(s.nextRunAt)}
              </td>
              <td className="px-3 py-2 font-mono text-[11px] text-text-3">
                {s.intervalMin % 1440 === 0 ? `${s.intervalMin / 1440} 天` : `${s.intervalMin} 分`}
              </td>
              <td className="px-3 py-2 font-mono text-[11px]">
                <span className="text-amber">{s.rows.pending}</span>
                <span className="mx-0.5 text-text-3">/</span>
                <span className="text-green">{s.rows.enabled}</span>
                {s.rows.recheck > 0 && (
                  <>
                    <span className="mx-0.5 text-text-3">/</span>
                    <span className="text-red">{s.rows.recheck}</span>
                  </>
                )}
              </td>
              <td className="px-3 py-2 text-[11px]">
                {s.lastCapture === null ? (
                  <span className="text-text-3">尚无快照</span>
                ) : (
                  <>
                    <span
                      className={
                        s.lastCapture.parseStatus === "success"
                          ? "text-green"
                          : s.lastCapture.parseStatus === "failed"
                            ? "text-red"
                            : "text-amber"
                      }
                    >
                      {PARSE_LABELS[s.lastCapture.parseStatus] ?? s.lastCapture.parseStatus}
                    </span>
                    <span className="ml-1 font-mono text-[10.5px] text-text-3">
                      {fmtTime(s.lastCapture.at)}
                      {s.lastCapture.rowCount !== null && ` · ${s.lastCapture.rowCount} 行`}
                    </span>
                    {s.lastCapture.error !== null && s.lastCapture.error !== "" && (
                      <div
                        title={s.lastCapture.error}
                        className="mt-0.5 max-w-[280px] truncate text-[10.5px] text-red"
                      >
                        {s.lastCapture.error}
                      </div>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
