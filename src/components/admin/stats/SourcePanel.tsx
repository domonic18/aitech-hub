/**
 * 流量来源卡(原型 admin-stats):四类(direct/search/referral/ai)细分进度条。
 * 分类色 token 映射(禁裸色值):ai=accent(GEO 战略指标用品牌色)/
 * search=blue/referral=amber/direct=text-3。纯 RSC。
 */
import type { ReferrerPanel } from "@/lib/stats/queries";
import type { SourceClass } from "@/lib/stats/classify";

const CLASS_META: Record<SourceClass, { label: string; color: string; chip: string }> = {
  direct: {
    label: "DIRECT",
    color: "var(--text-3)",
    chip: "text-text-3 bg-panel-2 border-line",
  },
  search: {
    label: "SEARCH",
    color: "var(--blue)",
    chip: "text-blue border border-blue/25 bg-blue/8",
  },
  ai: {
    label: "AI 助手",
    color: "var(--accent)",
    chip: "text-accent border border-accent/30 bg-accent-dim",
  },
  referral: {
    label: "站外",
    color: "var(--amber)",
    chip: "text-amber border border-amber/25 bg-amber/8",
  },
};

const CLASS_ORDER: SourceClass[] = ["direct", "search", "ai", "referral"];

export default function SourcePanel({ panel }: { panel: ReferrerPanel }): React.ReactElement {
  const ordered = CLASS_ORDER.flatMap((cls) => panel.rows.filter((r) => r.sourceClass === cls));
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex items-center gap-3 px-5 pt-4">
        <h3 className="text-sm font-semibold">流量来源</h3>
        <span className="font-mono text-[10px] text-text-3">[SOURCES · 近 7 日]</span>
      </div>
      <div className="flex flex-col gap-2.5 p-5 pt-3">
        {ordered.length === 0 && (
          <p className="py-8 text-center font-mono text-xs text-text-3">暂无来源数据</p>
        )}
        {ordered.map((r) => {
          const meta = CLASS_META[r.sourceClass];
          const pct = panel.totalPv === 0 ? 0 : (r.pv / panel.totalPv) * 100;
          return (
            <div
              key={`${r.sourceClass}:${r.sourceName}`}
              className="grid grid-cols-[minmax(96px,150px)_minmax(0,1fr)_auto] items-center gap-3"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[13px] text-text-1">
                  {r.sourceClass === "direct" ? "直接访问" : r.sourceName}
                </span>
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
                {r.pv.toLocaleString("en-US")} · {pct.toFixed(1)}%
              </div>
            </div>
          );
        })}
        <p className="mt-1 border-t border-dashed border-line pt-3 text-[11px] leading-relaxed text-text-3">
          AI 助手类目是 GEO 核心观测指标(requirement §3.5);仅入口页记录来源, 站内跳转按直接访问计;UV
          为 IP+UA 匿名哈希去重。
        </p>
      </div>
    </div>
  );
}
