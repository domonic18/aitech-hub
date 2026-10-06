/**
 * 热门搜索表(2026-10-06 需求):/search 页 counted PV 携带的搜索词排行。
 * 分段与热门页面共用 hot 参数(页面级「时段」概念,两表同步切换),
 * URL 驱动保留 trend;搜索词行级直插,准实时(无 60s flush 延迟)。
 */
import Link from "next/link";

import type { HotRange, HotSearchTermRow } from "@/lib/stats/queries";

const RANGES: Array<{ key: HotRange; label: string }> = [
  { key: "today", label: "今日" },
  { key: "7d", label: "近 7 天" },
  { key: "30d", label: "近 30 天" },
  { key: "all", label: "全部" },
];

export default function HotSearchTermsTable({
  rows,
  range,
  trend,
}: {
  rows: HotSearchTermRow[];
  range: HotRange;
  trend: 7 | 30 | 90;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pt-4">
        <h3 className="text-sm font-semibold">热门搜索</h3>
        <div className="ml-auto flex overflow-hidden rounded-sm border border-line">
          {RANGES.map((r) => (
            <Link
              key={r.key}
              href={`/admin/?trend=${trend}&hot=${r.key}`}
              className={`border-r border-line px-3 py-1.5 text-xs last:border-r-0 ${
                r.key === range
                  ? "bg-accent-dim font-semibold text-accent"
                  : "bg-panel text-text-2 hover:bg-panel-2"
              }`}
            >
              {r.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto p-2">
        {rows.length === 0 ? (
          <p className="py-10 text-center font-mono text-xs text-text-3">该时段暂无搜索</p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-xs text-text-3">
                <th className="w-12 px-3 py-2 font-normal">排名</th>
                <th className="px-3 py-2 font-normal">搜索词</th>
                <th className="w-24 px-3 py-2 text-right font-normal">次数</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.term}
                  className="border-b border-line/60 last:border-b-0 hover:bg-panel-2"
                >
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex h-5 w-5 items-center justify-center rounded-sm font-mono text-[11px] ${
                        i < 2 ? "bg-accent text-white" : "bg-panel-2 text-text-3"
                      }`}
                    >
                      {i + 1}
                    </span>
                  </td>
                  <td className="max-w-0 px-3 py-2.5">
                    <div className="truncate text-text-1" title={r.term}>
                      {r.term}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-text-1">
                    {r.count.toLocaleString("en-US")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="border-t border-dashed border-line px-5 py-3 text-[11px] leading-relaxed text-text-3">
        口径:/search 页 counted PV 携带的查询词(去爬虫/管理员;用户输入原文,截 100 字);
        同词重复搜索各计一次;行级直插准实时,明细保留 180 天。
      </p>
    </div>
  );
}
