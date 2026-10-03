/**
 * 访客环境卡(原型 admin-stats):浏览器 + 设备类型两组 PV 分布。
 * stats_client_daily 无 uv 字段(采集一期口径),按 PV 口径展示——显式注记。
 * 设备色 token 映射:desktop=green/mobile=accent/tablet=amber。
 */
import type { ClientPanel } from "@/lib/stats/queries";

const DEVICE_COLOR: Record<string, string> = {
  desktop: "var(--green)",
  mobile: "var(--accent)",
  tablet: "var(--amber)",
};

function Block({
  title,
  rows,
  colorOf,
}: {
  title: string;
  rows: Array<{ name: string; pv: number }>;
  colorOf: (name: string) => string;
}): React.ReactElement {
  const total = rows.reduce((acc, r) => acc + r.pv, 0);
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold text-text-2">{title}</h4>
      {rows.length === 0 ? (
        <p className="py-3 text-center font-mono text-xs text-text-3">暂无数据</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const pct = total === 0 ? 0 : (r.pv / total) * 100;
            return (
              <div key={r.name} className="grid grid-cols-[90px_1fr_64px] items-center gap-2">
                <span className="truncate text-xs text-text-1">{r.name}</span>
                <div className="h-2 overflow-hidden rounded-full bg-panel-2">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(pct, 1).toFixed(1)}%`,
                      background: colorOf(r.name),
                    }}
                  />
                </div>
                <span className="text-right font-mono text-[11px] text-text-2">
                  {pct.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function EnvPanel({ panel }: { panel: ClientPanel }): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex items-center gap-3 px-5 pt-4">
        <h3 className="text-sm font-semibold">访客环境</h3>
        <span className="font-mono text-[10px] text-text-3">[CLIENT · 近 7 日]</span>
      </div>
      <div className="flex flex-col gap-5 p-5 pt-3">
        <Block title="浏览器" rows={panel.browsers} colorOf={() => "var(--accent)"} />
        <Block
          title="设备类型"
          rows={panel.devices}
          colorOf={(n) => DEVICE_COLOR[n] ?? "var(--text-3)"}
        />
        <p className="border-t border-dashed border-line pt-3 text-[11px] leading-relaxed text-text-3">
          按 PV 口径(client 表一期未存 UV);bot 流量与管理员访问已在采集侧剔除。
        </p>
      </div>
    </div>
  );
}
