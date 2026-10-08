/**
 * 最近访问明细表(M10 批⑥,站点统计页尾部模块):行级 beacon 明细,
 * 全量 IP 短留存(7 天,worker 日清);路径为站内链接(truncate + title 全文);
 * 访客身份列不出(哈希仅排查用),来源 direct 折叠为「直达」。
 * 窄屏降级(2026-10-05):定宽列合计 576px,375px 下「页面」挤压列归零
 * (同热门页面表)——手机只留 时间/页面 两列,IP/来源/环境 sm 起恢复。
 */
import Link from "next/link";

import { formatCnDateTime } from "@/lib/datetime";
import type { RecentVisitRow } from "@/lib/stats/queries";

export default function RecentVisitsTable({
  rows,
}: {
  rows: RecentVisitRow[];
}): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pt-4">
        <h3 className="text-sm font-semibold">最近访问</h3>
        <span className="ml-auto text-[11px] text-text-3">近 7 天明细 · 到期由 worker 日清</span>
      </div>
      <div className="overflow-x-auto p-2">
        {rows.length === 0 ? (
          <p className="py-10 text-center font-mono text-xs text-text-3">暂无访问明细</p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-xs text-text-3">
                <th className="w-36 px-3 py-2 font-normal">时间</th>
                <th className="px-3 py-2 font-normal">页面</th>
                <th className="hidden w-32 px-3 py-2 font-normal sm:table-cell">IP</th>
                <th className="hidden w-24 px-3 py-2 font-normal sm:table-cell">来源</th>
                <th className="hidden w-52 px-3 py-2 font-normal sm:table-cell">环境</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line/60 last:border-b-0 hover:bg-panel-2">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-text-3">
                    {formatCnDateTime(r.createdAt)}
                  </td>
                  <td className="max-w-[11rem] px-3 py-2 sm:max-w-0">
                    <Link
                      href={r.path}
                      className="block truncate text-text-1 hover:text-accent-hover"
                      title={r.path}
                    >
                      {r.path}
                    </Link>
                  </td>
                  <td className="hidden px-3 py-2 font-mono text-xs text-text-2 sm:table-cell">
                    {r.ip}
                  </td>
                  <td className="hidden px-3 py-2 text-xs text-text-2 sm:table-cell">
                    {r.sourceClass === "direct" ? "直达" : r.sourceName}
                  </td>
                  <td className="hidden px-3 py-2 text-xs text-text-3 sm:table-cell">
                    {r.browser} · {r.os} · {r.deviceType}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
