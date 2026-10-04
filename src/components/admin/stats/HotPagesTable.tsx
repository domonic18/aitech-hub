/**
 * 热门页面表(原型 admin-stats):排名徽章(前 2 强调)+ 标题/路径 +
 * 类型 tag + PV/UV。平均阅读时长列一期不做(未采集,显式注记)。
 * 分段切换 URL 驱动,保留 trend 参数。
 */
import Link from "next/link";

import type { HotPageRow, HotRange } from "@/lib/stats/queries";

const RANGES: Array<{ key: HotRange; label: string }> = [
  { key: "today", label: "今日" },
  { key: "7d", label: "近 7 天" },
  { key: "30d", label: "近 30 天" },
  { key: "all", label: "全部" },
];

const KIND_META: Record<HotPageRow["kind"], { label: string; cls: string }> = {
  article: { label: "文章", cls: "text-accent bg-accent-dim" },
  page: { label: "页面", cls: "text-green bg-green/10" },
  list: { label: "列表", cls: "text-text-2 bg-panel-2" },
};

/** 采集存的是编码后 URL 路径,展示解码(畸形序列原样兜底) */
function shown(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

export default function HotPagesTable({
  rows,
  range,
  trend,
}: {
  rows: HotPageRow[];
  range: HotRange;
  trend: 7 | 30 | 90;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pt-4">
        <h3 className="text-sm font-semibold">热门页面</h3>
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
          <p className="py-10 text-center font-mono text-xs text-text-3">该时段暂无页面浏览</p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-xs text-text-3">
                <th className="w-12 px-3 py-2 font-normal">排名</th>
                <th className="px-3 py-2 font-normal">页面</th>
                <th className="w-16 px-3 py-2 font-normal">类型</th>
                <th className="w-24 px-3 py-2 text-right font-normal">PV</th>
                <th className="w-24 px-3 py-2 text-right font-normal">UV</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const kind = KIND_META[r.kind];
                return (
                  <tr
                    key={r.path}
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
                      <div className="truncate text-text-1" title={r.postTitle ?? shown(r.path)}>
                        {r.postTitle ?? shown(r.path)}
                      </div>
                      <div className="truncate font-mono text-[11px] text-text-3" title={r.path}>
                        {shown(r.path)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-sm px-1.5 py-px text-[10px] ${kind.cls}`}>
                        {kind.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-text-1">
                      {r.pv.toLocaleString("en-US")}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-text-2">
                      {r.uv.toLocaleString("en-US")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="border-t border-dashed border-line px-5 py-3 text-[11px] leading-relaxed text-text-3">
        平均阅读时长未采集,一期不做该列;文章 PV 与前台阅读计数同源 (views_count 累加自
        stats_post_view_daily);llms.txt 与 *.md 直出不计 PV。
      </p>
    </div>
  );
}
