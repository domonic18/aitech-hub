/**
 * GEO 机器面卡(2026-10-09 方案A):llms.txt 索引 / llms-full 全文 / 文章 .md
 * 直出三个机器专属面的抓取观测——面 × 爬虫分布 + 文章 TopN。与爬虫流量卡互补:
 * 那张看「谁在抓页面」,这张看「机器面被谁、消费哪些文章」。任何 UA 都入账
 * (未识别记 unknown-agent);.md 抓取不计入真人阅读数。纯 RSC。
 */
import { GEO_SURFACE_LABELS } from "@/lib/stats/geo";
import type { GeoPanel as GeoPanelData } from "@/lib/stats/queries";

const KIND_META: Record<"ai" | "search" | "other", { label: string; color: string; chip: string }> =
  {
    ai: {
      label: "AI",
      color: "var(--accent)",
      chip: "text-accent border border-accent/30 bg-accent-dim",
    },
    search: {
      label: "搜索",
      color: "var(--blue)",
      chip: "text-blue border border-blue/25 bg-blue/8",
    },
    other: {
      label: "其他",
      color: "var(--text-3)",
      chip: "text-text-3 bg-panel-2 border-line",
    },
  };

export default function GeoPanel({ panel }: { panel: GeoPanelData }): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex items-center gap-3 px-5 pt-4">
        <h3 className="text-sm font-semibold">GEO 机器面</h3>
        <span className="font-mono text-[10px] text-text-3">[GEO · 近 7 日]</span>
      </div>
      <div className="flex flex-col gap-2.5 p-5 pt-3">
        <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-text-2">
          <span>
            抓取合计 <span className="text-text-1">{panel.totalPv.toLocaleString("en-US")}</span>
          </span>
          {panel.bySurface.map((s) => (
            <span key={s.surface}>
              {GEO_SURFACE_LABELS[s.surface]}{" "}
              <span className="text-text-1">{s.pv.toLocaleString("en-US")}</span>
            </span>
          ))}
        </div>
        {panel.byBot.map((b) => {
          const meta = KIND_META[b.kind];
          const pct = panel.totalPv === 0 ? 0 : (b.pv / panel.totalPv) * 100;
          return (
            <div
              key={b.name}
              className="grid grid-cols-[minmax(96px,150px)_minmax(0,1fr)_auto] items-center gap-3"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-[12px] text-text-1">{b.name}</span>
                <span className={`flex-none rounded-sm px-1.5 py-px text-[10px] ${meta.chip}`}>
                  {meta.label}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-panel-2">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(pct, 0.5).toFixed(1)}%`, background: meta.color }}
                />
              </div>
              <div className="text-right font-mono text-xs text-text-2">
                {b.pv.toLocaleString("en-US")} · {pct.toFixed(1)}%
              </div>
            </div>
          );
        })}
        {panel.topPosts.length > 0 && (
          <div className="mt-1 border-t border-dashed border-line pt-3">
            <p className="mb-1.5 font-mono text-[10px] text-text-3">[POST_MD · 文章 TopN]</p>
            <div className="flex flex-col gap-1">
              {panel.topPosts.map((p) => (
                <div key={p.postId} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-text-2">
                    {p.title ?? <span className="text-text-3">#{p.postId}(已删除)</span>}
                  </span>
                  <span className="flex-none font-mono text-text-2">
                    {p.pv.toLocaleString("en-US")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {panel.totalPv === 0 && (
          <p className="py-6 text-center font-mono text-xs text-text-3">
            暂无 GEO 抓取数据(上线后随抓取积累)
          </p>
        )}
        <p className="mt-1 border-t border-dashed border-line pt-3 text-[11px] leading-relaxed text-text-3">
          GEO 面(llms.txt / llms-full / 文章 .md)由 middleware 对任何 UA 入账,未识别 UA 记
          unknown-agent;.md 抓取不计入真人阅读数(views_count 口径不变)。
        </p>
      </div>
    </div>
  );
}
