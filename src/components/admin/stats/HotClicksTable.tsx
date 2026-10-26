/**
 * 热门条目点击表(M28 批①):首页/电报流条目点击排行(kind+ref 聚合,跨面合计),
 * 标题读侧反解(删除兜底占位);底部附外链域名分布。分段与热门页面/热门搜索
 * 共用 hot 参数(页面级「时段」概念三表同步切换);行级直插准实时。
 */
import Link from "next/link";

import type { ClickDomainRow, HotClickRow } from "@/lib/stats/clicks";
import type { HotRange } from "@/lib/stats/queries";

const RANGES: Array<{ key: HotRange; label: string }> = [
  { key: "today", label: "今日" },
  { key: "7d", label: "近 7 天" },
  { key: "30d", label: "近 30 天" },
  { key: "all", label: "全部" },
];

const KIND_LABELS: Record<HotClickRow["kind"], string> = {
  telegram: "电报条目",
  project: "开源项目",
  post: "文章",
};

export default function HotClicksTable({
  rows,
  domains,
  range,
  trend,
}: {
  rows: HotClickRow[];
  domains: ClickDomainRow[];
  range: HotRange;
  trend: 7 | 30 | 90;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pt-4">
        <h3 className="text-sm font-semibold">热门点击</h3>
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
          <p className="py-10 text-center font-mono text-xs text-text-3">该时段暂无条目点击</p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-xs text-text-3">
                <th className="w-12 px-3 py-2 font-normal">排名</th>
                <th className="px-3 py-2 font-normal">条目</th>
                <th className="w-20 px-3 py-2 font-normal">类型</th>
                <th className="w-20 px-3 py-2 text-right font-normal">点击</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.kind}:${r.ref}`}
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
                    <div className="truncate text-text-1" title={r.title}>
                      {r.title}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-text-3">
                    {KIND_LABELS[r.kind]}
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
      {domains.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-dashed border-line px-5 py-3">
          <span className="mr-1 font-mono text-[11px] text-text-3">外链域名分布</span>
          {domains.map((d) => (
            <span
              key={d.domain}
              className="rounded-sm border border-blue/25 bg-blue/10 px-1.5 py-px font-mono text-[11px] text-blue"
              title={`${d.domain} × ${d.count}`}
            >
              {d.domain} · {d.count.toLocaleString("en-US")}
            </span>
          ))}
        </div>
      )}
      <p className="border-t border-dashed border-line px-5 py-3 text-[11px] leading-relaxed text-text-3">
        口径:首页/电报流条目锚点点击(beacon;去爬虫/管理员);同一电报条目首页带与电报流页
        点击合并计数;行级直插准实时,明细保留 180 天。
      </p>
    </div>
  );
}
