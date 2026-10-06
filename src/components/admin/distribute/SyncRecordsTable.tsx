"use client";

/**
 * 公众号同步记录表(M17 批①;行操作「重新同步/清除绑定」批⑤接):
 * 文章(链编辑页)/ 状态 soft chip(同 PostStatusBadge 三色语言:
 * synced 绿 / pending 琥珀 / failed 红)/ 微调快照 / syncedAt / 尝试 / 错误。
 */
import Link from "next/link";

import type { PublishRecordRow } from "@/lib/distribute/records";

const STATUS_STYLES: Record<string, { chip: string; dot: string; label: string }> = {
  synced: { chip: "bg-green/12 text-green", dot: "bg-green", label: "已同步" },
  pending: { chip: "bg-amber/12 text-amber", dot: "bg-amber", label: "同步中" },
  failed: { chip: "bg-red/12 text-red", dot: "bg-red", label: "失败" },
};

function StatusBadge({ status }: { status: string }): React.ReactElement {
  const s = STATUS_STYLES[status] ?? {
    chip: "bg-panel-2 text-text-3",
    dot: "bg-text-3",
    label: status,
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium ${s.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  );
}

function fmtTime(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("zh-CN", { hour12: false });
}

export default function SyncRecordsTable({
  rows,
  total,
}: {
  rows: PublishRecordRow[];
  total: number;
}) {
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="text-[12.5px] text-text-2">同步记录</div>
        <div className="font-mono text-[11px] text-text-3">共 {total} 条</div>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-xs text-text-3">
          暂无同步记录——在文章列表或编辑页点「同步公众号」后,这里记录每次推送状态
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-panel-2 text-[11px] text-text-3">
                <th className="px-4 py-2 font-medium">文章</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium">推送标题</th>
                <th className="px-3 py-2 font-medium">草稿 media_id</th>
                <th className="px-3 py-2 font-medium">同步时间</th>
                <th className="px-3 py-2 font-medium">尝试</th>
                <th className="px-4 py-2 font-medium">错误</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-line/60 last:border-0 hover:bg-panel-2/60"
                >
                  <td className="max-w-[220px] px-4 py-2">
                    <Link
                      href={`/admin/posts/${r.postId}`}
                      className="block truncate text-accent hover:underline"
                      title={r.postTitle}
                    >
                      {r.postTitle}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td
                    className="max-w-[180px] truncate px-3 py-2 text-text-2"
                    title={r.title ?? ""}
                  >
                    {r.title ?? "—"}
                  </td>
                  <td
                    className="max-w-[160px] truncate px-3 py-2 font-mono text-[11px] text-text-2"
                    title={r.mediaId ?? ""}
                  >
                    {r.mediaId ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-text-2">{fmtTime(r.syncedAt)}</td>
                  <td className="px-3 py-2 font-mono text-text-3">{r.attempts}</td>
                  <td
                    className="max-w-[240px] truncate px-4 py-2 text-red"
                    title={r.lastError ?? ""}
                  >
                    {r.lastError ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
