/**
 * 爬虫流量卡(2026-10-07 方案B):AI 爬虫 / 搜索引擎爬虫抓取细分进度条,
 * 样式镜像 SourcePanel。数据同表分账(stats_referrer_daily source_class='bot'),
 * 不进流量来源卡;抓取 PV 不计入真人 KPI(人机区分的「机」侧)。纯 RSC。
 */
import type { BotPanel as BotPanelData } from "@/lib/stats/queries";

const KIND_META: Record<
  BotPanelData["rows"][number]["kind"],
  { label: string; color: string; chip: string }
> = {
  ai: {
    label: "AI 爬虫",
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

export default function BotPanel({
  panel,
  humanPv,
}: {
  panel: BotPanelData;
  humanPv: number;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex items-center gap-3 px-5 pt-4">
        <h3 className="text-sm font-semibold">爬虫流量</h3>
        <span className="font-mono text-[10px] text-text-3">[BOTS · 近 7 日]</span>
      </div>
      <div className="flex flex-col gap-2.5 p-5 pt-3">
        <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-text-2">
          <span>
            AI 爬虫 <span className="text-text-1">{panel.aiPv.toLocaleString("en-US")}</span>
          </span>
          <span>
            搜索爬虫 <span className="text-text-1">{panel.searchPv.toLocaleString("en-US")}</span>
          </span>
          <span className="text-text-3">真人 PV(近 7 日){humanPv.toLocaleString("en-US")}</span>
        </div>
        {panel.rows.length === 0 ? (
          <p className="py-6 text-center font-mono text-xs text-text-3">
            暂无爬虫抓取数据(上线后随抓取积累)
          </p>
        ) : (
          panel.rows.map((r) => {
            const meta = KIND_META[r.kind];
            const pct = panel.totalPv === 0 ? 0 : (r.pv / panel.totalPv) * 100;
            return (
              <div
                key={r.name}
                className="grid grid-cols-[minmax(96px,150px)_minmax(0,1fr)_auto] items-center gap-3"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-[12px] text-text-1">{r.name}</span>
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
          })
        )}
        <p className="mt-1 border-t border-dashed border-line pt-3 text-[11px] leading-relaxed text-text-3">
          爬虫抓取由 middleware 按 UA 名单识别(AI 训练/检索 + 搜索引擎),不计入真人 PV/UV 与流量来源;
          未识别 UA 不入账。
        </p>
      </div>
    </div>
  );
}
