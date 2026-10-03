/**
 * 采集总览页(M7 批④c,侧栏「采集总览」):队列实况/采集日历/库存概况/
 * 渠道运行态/最近错误。纯只读 RSC;治理动作在电报流治理页,渠道管理在台账页。
 */
import { requireAdminPage } from "@/lib/auth/guard";
import { formatCnDateTime } from "@/lib/datetime";
import { listChannelsAdmin } from "@/lib/telegram/channels-admin";
import {
  getCrawlerQueueSnapshot,
  getIngestCalendar,
  getTelegramStock,
} from "@/lib/telegram/spider-queries";

export const dynamic = "force-dynamic";

const STOCK_LABELS: Record<string, string> = {
  visible: "可见",
  hidden: "隐藏(含过滤命中)",
  archived: "归档",
  deleted: "软删",
};

export default async function AdminSpiderPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const [snapshot, calendar, stock, channels] = await Promise.all([
    getCrawlerQueueSnapshot(),
    getIngestCalendar(14),
    getTelegramStock(),
    listChannelsAdmin(),
  ]);
  const maxDay = Math.max(1, ...calendar.map((c) => c.count));
  const stockTotal = Object.values(stock).reduce((a, b) => a + b, 0);

  const card = "flex-1 rounded-md border border-line bg-panel px-4 py-3 min-w-[120px]";
  const cardLabel = "text-[11px] text-text-3";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">采集总览</h2>
        <p className="mt-0.5 text-xs text-text-3">
          crawler 队列实况与渠道健康;tick 调度器每分钟扫描到期渠道。
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className={card}>
          <div className="flex items-center gap-2">
            <span className={cardLabel}>tick 调度器</span>
            {snapshot.tickAlive ? (
              <span className="rounded-sm bg-green/10 px-1.5 py-px text-[10px] text-green">
                存活
              </span>
            ) : (
              <span className="rounded-sm bg-red/10 px-1.5 py-px text-[10px] text-red">
                未注册(worker 未启动?)
              </span>
            )}
          </div>
        </div>
        <div className={card}>
          <div className="font-mono text-xl font-semibold text-text-1">
            {snapshot.counts.waiting}
          </div>
          <div className={cardLabel}>排队 waiting</div>
        </div>
        <div className={card}>
          <div className="font-mono text-xl font-semibold text-text-1">
            {snapshot.counts.active}
          </div>
          <div className={cardLabel}>进行中 active</div>
        </div>
        <div className={card}>
          <div className="font-mono text-xl font-semibold text-text-1">
            {snapshot.counts.completed}
          </div>
          <div className={cardLabel}>已完成(近 200 条留存)</div>
        </div>
        <div className={card}>
          <div
            className={`font-mono text-xl font-semibold ${
              snapshot.counts.failed > 0 ? "text-red" : "text-text-1"
            }`}
          >
            {snapshot.counts.failed}
          </div>
          <div className={cardLabel}>失败</div>
        </div>
        <div className={card}>
          <div className="font-mono text-xl font-semibold text-text-1">{stockTotal}</div>
          <div className={cardLabel}>条目库存</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-line bg-panel p-4">
          <h3 className="text-sm font-semibold">采集日历(近 14 天入库)</h3>
          <div className="mt-3 flex flex-col gap-1.5">
            {calendar.map((c) => (
              <div key={c.day} className="flex items-center gap-2">
                <span className="w-20 shrink-0 font-mono text-[11px] text-text-3">{c.day}</span>
                <div className="h-3 flex-1 rounded-sm bg-panel-2">
                  <div
                    className="h-3 rounded-sm bg-accent"
                    style={{ width: `${(c.count / maxDay) * 100}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right font-mono text-[11px] text-text-2">
                  {c.count}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-text-3">
            {Object.entries(stock).map(([status, n]) => (
              <span key={status}>
                {STOCK_LABELS[status] ?? status}:<b className="text-text-2">{n}</b>
              </span>
            ))}
            {stockTotal === 0 && <span>暂无条目</span>}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-line bg-panel p-4">
            <h3 className="text-sm font-semibold">渠道运行态</h3>
            <table className="mt-2 w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-xs text-text-3">
                  <th className="py-1.5 font-medium">渠道</th>
                  <th className="py-1.5 font-medium">健康</th>
                  <th className="py-1.5 font-medium">上轮</th>
                  <th className="py-1.5 font-medium">下轮</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-b-0">
                    <td className="py-1.5 text-text-1">
                      {c.name}
                      {!c.enabled && (
                        <span className="ml-1 font-mono text-[10px] text-text-3">(停用)</span>
                      )}
                    </td>
                    <td className="py-1.5 font-mono text-[11px] text-text-2">
                      {c.status}
                      {c.consecutiveFails > 0 && ` ×${c.consecutiveFails}`}
                    </td>
                    <td className="py-1.5 font-mono text-[11px] text-text-3">
                      {c.lastRunAt ? formatCnDateTime(c.lastRunAt) : "—"}
                    </td>
                    <td className="py-1.5 font-mono text-[11px] text-text-3">
                      {c.enabled && c.nextRunAt ? formatCnDateTime(c.nextRunAt) : "—"}
                    </td>
                  </tr>
                ))}
                {channels.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-xs text-text-3">
                      尚未配置渠道
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-md border border-line bg-panel p-4">
            <h3 className="text-sm font-semibold">最近错误(队列失败任务)</h3>
            <ul className="mt-2 flex flex-col gap-2">
              {snapshot.recentFailed.map((f) => (
                <li key={f.id} className="rounded-sm border border-line bg-panel-2 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-text-3">
                    <span>
                      {f.name} · {f.id}
                    </span>
                    <span>{f.at ? formatCnDateTime(f.at) : "—"}</span>
                  </div>
                  <div className="mt-1 font-mono text-xs break-all text-red">{f.reason}</div>
                </li>
              ))}
              {snapshot.recentFailed.length === 0 && (
                <li className="py-2 text-xs text-text-3">无失败任务</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
