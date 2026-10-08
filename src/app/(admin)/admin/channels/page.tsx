/**
 * 渠道台账页(M7 批④,侧栏「渠道配置」):crawl_source 全量列表。
 * 端点与凭证均脱敏展示(maskUrlSecrets/maskConfig);凭证只写不读,
 * 采集频率与健康度(连续失败/上下轮时间)一屏可见。
 */
import ChannelDialog from "@/components/admin/ChannelDialog";
import ChannelRowOps from "@/components/admin/ChannelRowOps";
import StatusSwitch from "@/components/admin/StatusSwitch";
import { requireAdminPage } from "@/lib/auth/guard";
import { formatCnDateTime } from "@/lib/datetime";
import { CRAWL_SOURCE_STATUS_ERROR, CRAWL_SOURCE_STATUS_HEALTHY } from "@/lib/telegram/constants";
import { listChannelsAdmin } from "@/lib/telegram/channels-admin";

export const dynamic = "force-dynamic";

function StatusBadge({ status, fails }: { status: string; fails: number }) {
  if (status === CRAWL_SOURCE_STATUS_HEALTHY) {
    return (
      <span className="rounded-sm bg-green/10 px-1.5 py-px text-[10px] text-green">healthy</span>
    );
  }
  if (status === CRAWL_SOURCE_STATUS_ERROR) {
    return (
      <span
        className="rounded-sm bg-red/10 px-1.5 py-px text-[10px] text-red"
        title={`连续失败 ${fails} 次`}
      >
        error
      </span>
    );
  }
  return (
    <span
      className="rounded-sm bg-amber/10 px-1.5 py-px text-[10px] text-amber"
      title={`连续失败 ${fails} 次`}
    >
      degraded
    </span>
  );
}

export default async function AdminChannelsPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const items = await listChannelsAdmin();
  const enabledCount = items.filter((c) => c.enabled).length;
  const total24h = items.reduce((sum, c) => sum + c.count24h, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">渠道配置</h2>
          <p className="mt-0.5 text-xs text-text-3">
            采集渠道台账:端点/频率/凭证/健康度。凭证存 config 不入环境变量,展示一律脱敏。
          </p>
          <p className="mt-1 font-mono text-[11px] text-text-3">
            {items.length} 个渠道 · {enabledCount} 启用 · 24h 共入流 {total24h} 条
          </p>
        </div>
        <ChannelDialog label="新增渠道" />
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-xs text-text-3">
              <th className="px-4 py-2.5 font-medium">渠道</th>
              <th className="px-3 py-2.5 font-medium">类型</th>
              <th className="px-3 py-2.5 font-medium">端点</th>
              <th className="px-3 py-2.5 font-medium">频率</th>
              <th className="px-3 py-2.5 font-medium">启用</th>
              <th className="px-3 py-2.5 font-medium">凭证</th>
              <th className="px-3 py-2.5 font-medium">健康</th>
              <th className="px-3 py-2.5 font-medium">调度</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">24h 条数</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr
                key={c.id}
                className={`border-b border-line last:border-b-0 hover:bg-panel-2 ${
                  c.enabled ? "" : "opacity-60"
                }`}
              >
                <td className="px-4 py-2.5">
                  <div className="font-medium text-text-1">{c.name}</div>
                  {c.remark && <div className="mt-0.5 text-[11px] text-text-3">{c.remark}</div>}
                </td>
                <td className="px-3 py-2.5">
                  <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
                    {c.type}
                  </span>
                  {c.platform && (
                    <div className="mt-0.5 font-mono text-[11px] text-text-3">{c.platform}</div>
                  )}
                </td>
                <td className="max-w-[220px] px-3 py-2.5">
                  <div className="truncate font-mono text-[11px] text-text-2" title={c.url}>
                    {c.url}
                  </div>
                </td>
                <td className="px-3 py-2.5 font-mono text-[11px] text-text-2">
                  {c.crawlIntervalMin}min
                  <div className="text-text-3">日≤{c.dailyMaxRequests ?? "∞"}</div>
                </td>
                <td className="px-3 py-2.5">
                  <StatusSwitch
                    endpoint={`/api/channels/${c.id}/status`}
                    enabled={c.enabled}
                    name={c.name}
                    disableHint={`确认停用「${c.name}」?停用后调度器不再派发采集任务。`}
                  />
                </td>
                <td className="px-3 py-2.5 font-mono text-[11px] text-text-2">
                  {c.maskedConfig?.token ?? "—"}
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={c.status} fails={c.consecutiveFails} />
                </td>
                <td className="px-3 py-2.5 text-[11px] leading-relaxed text-text-3">
                  上轮 {c.lastRunAt ? formatCnDateTime(c.lastRunAt) : "—"}
                  <br />
                  下轮 {c.enabled && c.nextRunAt ? formatCnDateTime(c.nextRunAt) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-[11px] text-text-2">
                  {c.count24h}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  <ChannelRowOps
                    channel={{
                      id: c.id,
                      name: c.name,
                      type: c.type,
                      platform: c.platform,
                      url: c.url,
                      crawlIntervalMin: c.crawlIntervalMin,
                      dailyMaxRequests: c.dailyMaxRequests,
                      remark: c.remark,
                      enabled: c.enabled,
                      credentialMask: c.maskedConfig?.token ?? "",
                    }}
                  />
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-xs text-text-3">
                  还没有渠道,点右上角「新增渠道」接入第一批
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-text-3">
        说明:调度器每分钟扫描到期渠道逐源入队(单源失败隔离);每日上限超限跳过不计失败; 供应方 429
        限频同样不污染健康度。凭证仅在编辑弹窗写入(留空沿用,勾选清除),
        服务端日志不落凭证值。API:GET/POST /api/channels · PUT /api/channels/[id] · PUT
        /api/channels/[id]/status · POST /api/channels/[id]/crawl|debug。
      </p>
    </div>
  );
}
